// @vitest-environment jsdom
// Blaze helpers are plain functions called with the data context as `this`, so these
// invoke the real registrations against real transform-wrapped documents from
// FakeCollection — the same objects the template would receive.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../client/views/cards/cards.js';
import { callHelper, resetClientState, templateEvent } from '../clientSetup.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { resetRouter, setRoute } from '../stubs/flow-router.js';
import { insertCards, insertGame, insertPlayer } from '../helpers/fixtures.js';
import { CardLogic } from '../../both/cardlogic.js';
import { GameLogic } from '../../both/gamelogic.js';
import { GameState } from '../../both/gamestate.js';

const E = CardLogic.EMPTY;
const TURN_RIGHT = 6;
const STEP_FORWARD = 48;

async function seat({ game: gameOverrides = {}, player: playerOverrides = {}, cards = {} } = {}) {
  const user = await loginAs('me');
  const game = await insertGame(gameOverrides);
  const player = await insertPlayer(game._id, {
    userId: user._id,
    name: 'me',
    ...playerOverrides,
  });
  await insertCards(player._id, game._id, { userId: user._id, ...cards });
  setRoute({ params: { _id: game._id }, name: 'board.page' });
  return { user, game, player };
}

beforeEach(() => {
  resetFakeCollections();
  resetClientState();
  resetRouter();
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

describe('gameState label', () => {
  it('returns an empty string when the route points at no game', async () => {
    expect(callHelper('cards', 'gameState')).toBe('');
  });

  it.each([
    [GameState.PHASE.IDLE, 'Dealing cards'],
    [GameState.PHASE.DEAL, 'Dealing cards'],
    [GameState.PHASE.ENDED, 'Game over'],
  ])('labels the %s phase "%s"', async (gamePhase, label) => {
    await seat({ game: { gamePhase } });

    expect(callHelper('cards', 'gameState')).toBe(label);
  });

  it.each([
    [GameState.PLAY_PHASE.IDLE, 'Revealing cards'],
    [GameState.PLAY_PHASE.REVEAL_CARDS, 'Revealing cards'],
    [GameState.PLAY_PHASE.MOVE_BOTS, 'Moving bots'],
    [GameState.PLAY_PHASE.MOVE_BOARD, 'Moving board elements'],
    [GameState.PLAY_PHASE.LASERS, 'Shooting lasers'],
    [GameState.PLAY_PHASE.CHECKPOINTS, 'Checkpoints'],
    [GameState.PLAY_PHASE.REPAIRS, 'Repairing bots'],
  ])('labels play phase %s "%s"', async (playPhase, label) => {
    await seat({ game: { gamePhase: GameState.PHASE.PLAY, playPhase } });

    expect(callHelper('cards', 'gameState')).toBe(label);
  });

  it('falls through to "Problem?" for a play phase with no label', async () => {
    // LASER_OPTIONS is in the PLAY_PHASE enum but missing from the switch.
    await seat({
      game: { gamePhase: GameState.PHASE.PLAY, playPhase: GameState.PLAY_PHASE.LASER_OPTIONS },
    });

    expect(callHelper('cards', 'gameState')).toBe('Problem?');
  });

  describe('during programming', () => {
    it('tells a live player to pick cards', async () => {
      await seat({ game: { gamePhase: GameState.PHASE.PROGRAM } });

      expect(callHelper('cards', 'gameState')).toBe('Pick your cards');
    });

    it('says "No archives" once the player is out of lives', async () => {
      await seat({ game: { gamePhase: GameState.PHASE.PROGRAM }, player: { lives: 0 } });

      expect(callHelper('cards', 'gameState')).toBe('No archives');
    });

    it('says "Powered down" for a powered-down player', async () => {
      await seat({
        game: { gamePhase: GameState.PHASE.PROGRAM },
        player: { powerState: GameLogic.OFF, optionalInstantPowerDown: false },
      });

      expect(callHelper('cards', 'gameState')).toBe('Powered down');
    });

    it('asks a powered-down player who may opt back in to pick cards', async () => {
      await seat({
        game: { gamePhase: GameState.PHASE.PROGRAM },
        player: { powerState: GameLogic.OFF, optionalInstantPowerDown: true },
      });

      expect(callHelper('cards', 'gameState')).toBe('Pick your cards');
    });

    it('says "Players thinking" to a spectator', async () => {
      const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
      await loginAs('watcher');
      setRoute({ params: { _id: game._id } });

      expect(callHelper('cards', 'gameState')).toBe('Players thinking');
    });
  });

  describe('during respawn', () => {
    it.each([
      [GameState.RESPAWN_PHASE.CHOOSE_POSITION, 'Choose position'],
      [GameState.RESPAWN_PHASE.CHOOSE_DIRECTION, 'Choose direction'],
    ])('prompts the respawning player: %s', async (respawnPhase, label) => {
      await seat({
        game: { gamePhase: GameState.PHASE.RESPAWN, respawnPhase, respawnUserId: 'me' },
      });

      expect(callHelper('cards', 'gameState')).toBe(label);
    });

    it('tells everyone else to wait', async () => {
      await seat({
        game: {
          gamePhase: GameState.PHASE.RESPAWN,
          respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
          respawnUserId: 'someone-else',
        },
      });

      expect(callHelper('cards', 'gameState')).toBe('Waiting for destroyed bots to reenter');
    });
  });
});

describe('showCards', () => {
  it('shows the hand to a live, unsubmitted player during programming', async () => {
    await seat({ game: { gamePhase: GameState.PHASE.PROGRAM }, player: { submitted: false } });

    expect(callHelper('cards', 'showCards')).toBe(true);
  });

  it.each([
    ['the player already submitted', { submitted: true }],
    ['the player has no lives left', { lives: 0 }],
  ])('hides the hand when %s', async (_label, playerOverrides) => {
    await seat({ game: { gamePhase: GameState.PHASE.PROGRAM }, player: playerOverrides });

    expect(callHelper('cards', 'showCards')).toBeFalsy();
  });

  it('hides the hand outside the programming phase', async () => {
    await seat({ game: { gamePhase: GameState.PHASE.PLAY } });

    expect(callHelper('cards', 'showCards')).toBe(false);
  });
});

describe('register and hand rows', () => {
  it('renders the register with slot indices and the locked tail', async () => {
    // lockedCnt() = max(0, 5 + damage - 9); damage 5 locks the last slot.
    await seat({
      player: { damage: 5 },
      cards: { chosenCards: [TURN_RIGHT, E, E, E, STEP_FORWARD] },
    });

    const row = callHelper('cards', 'chosenCards');

    expect(row.map((c) => c.slot)).toEqual([0, 1, 2, 3, 4]);
    expect(row[0].type).toBe('turn-right');
    expect(row[1].type).toBe('empty');
    expect(row[4].locked).toBe(true);
  });

  it('pads the hand out to nine cards with damage placeholders', async () => {
    await seat({ cards: { handCards: [TURN_RIGHT, STEP_FORWARD] } });

    const hand = callHelper('cards', 'availableCards');

    expect(hand).toHaveLength(9);
    expect(hand.slice(2).every((c) => c.type === 'dmg')).toBe(true);
  });

  it('greys out a hand card already sitting in the register', async () => {
    await seat({
      cards: { handCards: [TURN_RIGHT, STEP_FORWARD], chosenCards: [STEP_FORWARD, E, E, E, E] },
    });

    const hand = callHelper('cards', 'availableCards');

    expect(hand[0].chosen).toBeUndefined();
    expect(hand[1].chosen).toBe(true);
  });
});

describe('power-down button', () => {
  it.each([
    [GameLogic.ON, 'announce power down', 'btn-outline-warning'],
    [GameLogic.DOWN, 'withdraw power down', 'btn-danger'],
    [GameLogic.OFF, 'cancel power down', 'btn-danger'],
  ])('labels power state %s as "%s"', async (powerState, name, style) => {
    await seat({ player: { powerState } });

    expect(callHelper('cards', 'ownPowerStateName')).toBe(name);
    expect(callHelper('cards', 'ownPowerStateStyle')).toBe(style);
    expect(callHelper('cards', 'poweredDown')).toBe(powerState === GameLogic.OFF);
  });
});

describe('submit button', () => {
  it('enables submit only once all five registers are filled', async () => {
    await seat({ player: { chosenCardsCnt: 4 } });
    expect(callHelper('cards', 'playBtnDisabled')).toBe('disabled');

    resetFakeCollections();
    await seat({ player: { chosenCardsCnt: 5 } });
    expect(callHelper('cards', 'playBtnDisabled')).toBe('');
  });

  it('enables submit for a powered-down player with an empty register', async () => {
    await seat({ player: { chosenCardsCnt: 0, powerState: GameLogic.OFF } });

    expect(callHelper('cards', 'playBtnDisabled')).toBe('');
  });

  it('hides the button once the player has submitted', async () => {
    await seat({ player: { submitted: true } });

    expect(callHelper('cards', 'showPlayButton')).toBe(false);
  });
});

describe('lives and damage', () => {
  it('renders three hearts, filled up to the life count', async () => {
    await seat({ player: { lives: 2 } });

    expect(callHelper('cards', 'lives')).toEqual(['fa-heart', 'fa-heart', 'fa-heart-o']);
  });

  it('renders damage as a percentage of ten', async () => {
    expect(callHelper('cards', 'dmgPercentage', { damage: 4 })).toBe(40);
  });
});

describe('option cards', () => {
  it('reports no options for a fresh player', async () => {
    await seat();

    expect(callHelper('cards', 'hasOptionCards')).toBe(false);
    expect(callHelper('cards', 'activeOptionCards')).toEqual([]);
  });

  it('titles and describes each held option', async () => {
    await seat({ player: { optionCards: { extra_memory: true } } });

    expect(callHelper('cards', 'hasOptionCards')).toBe(true);
    expect(callHelper('cards', 'activeOptionCards')).toEqual([
      {
        name: CardLogic.getOptionTitle('extra_memory'),
        desc: CardLogic.getOptionDesc('extra_memory'),
      },
    ]);
  });
});

describe('countdown timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div class="right-panel"><div class="card"></div><div class="card"></div></div>';
  });
  afterEach(() => vi.useRealTimers());

  const classesOfCards = () =>
    [...document.querySelectorAll('.right-panel .card')].map((el) => [...el.classList].sort());

  it('counts down and marks the cards as counting down', async () => {
    await seat({ game: { timer: 1, timerStartedAt: new Date(Date.now() - 10_000) } });

    expect(callHelper('cards', 'timer')).toBe(`(${GameLogic.TIMER - 10})`);
    expect(classesOfCards()).toEqual([
      ['card', 'countdown'],
      ['card', 'countdown'],
    ]);
  });

  it('switches to the finish styling in the last five seconds', async () => {
    await seat({ game: { timer: 1, timerStartedAt: new Date(Date.now() - 27_000) } });

    expect(callHelper('cards', 'timer')).toBe('(3)');
    expect(classesOfCards()).toEqual([
      ['card', 'finish'],
      ['card', 'finish'],
    ]);
  });

  it('shows nothing to a player who is out of the game', async () => {
    await seat({
      game: { timer: 1, timerStartedAt: new Date(Date.now() - 10_000) },
      player: { lives: 0 },
    });

    expect(callHelper('cards', 'timer')).toBe('');
    expect(classesOfCards()).toEqual([['card'], ['card']]);
  });

  it('drops the countdown styling once the player has submitted', async () => {
    await seat({
      game: { timer: 1, timerStartedAt: new Date(Date.now() - 10_000) },
      player: { submitted: true },
    });

    callHelper('cards', 'timer');

    expect(classesOfCards()).toEqual([['card'], ['card']]);
  });

  it('auto-submits when the server timer reaches zero', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await seat({ game: { timer: 0 } });

    callHelper('cards', 'timer');

    expect(call).toHaveBeenCalledWith('playCards', game._id);
  });

  it('does not auto-submit on behalf of a spectator', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const game = await insertGame({ timer: 0 });
    await loginAs('watcher');
    setRoute({ params: { _id: game._id } });

    callHelper('cards', 'timer');

    expect(call).not.toHaveBeenCalled();
  });
});

describe('other players', () => {
  it('lists everyone but the caller', async () => {
    const { game } = await seat();
    await insertPlayer(game._id, { userId: 'them', name: 'them' });

    const others = callHelper('cards', 'otherPlayers').fetch();

    expect(others.map((p) => p.name)).toEqual(['them']);
  });

  it('lists nobody when the route points at no game', () => {
    expect(callHelper('cards', 'otherPlayers')).toEqual([]);
  });
});

describe('playerStatus panel', () => {
  const panelFor = async (overrides = {}) => {
    const { game } = await seat();
    const other = await insertPlayer(game._id, { userId: 'them', name: 'them', ...overrides });
    return other;
  };

  it('names the caller "Your robot" and everyone else by name', async () => {
    await seat();

    expect(callHelper('playerStatus', 'playerName', { userId: 'me', name: 'me' })).toBe(
      'Your robot'
    );
    expect(callHelper('playerStatus', 'playerName', { userId: 'them', name: 'them' })).toBe('them');
  });

  it('renders the opponent register, hiding it once they are eliminated', async () => {
    const alive = await panelFor({ cards: [TURN_RIGHT, E, E, E, E] });
    expect(callHelper('playerStatus', 'cardsHtml', alive)[0].type).toBe('turn-right');

    const dead = await panelFor({ lives: 0, cards: [TURN_RIGHT, E, E, E, E] });
    expect(callHelper('playerStatus', 'cardsHtml', dead)).toEqual([]);
  });

  it('flags the player who reached the last checkpoint as the winner', async () => {
    const board = (await panelFor()).board();
    const winner = await panelFor({ visited_checkpoints: board.checkpoints.length });
    const nearly = await panelFor({ visited_checkpoints: board.checkpoints.length - 1 });

    expect(callHelper('playerStatus', 'isWinner', winner)).toBe(true);
    expect(callHelper('playerStatus', 'isWinner', nearly)).toBe(false);
    expect(callHelper('playerStatus', 'headingForFinish', nearly)).toBe(true);
  });

  it('caps the next-checkpoint number at the last checkpoint', async () => {
    const board = (await panelFor()).board();
    const winner = await panelFor({ visited_checkpoints: board.checkpoints.length });

    expect(callHelper('playerStatus', 'nextCheckpoint', winner)).toBe(board.checkpoints.length);
  });

  it('shows the submitted label only during programming', async () => {
    const submitted = await panelFor({ submitted: true });
    expect(callHelper('playerStatus', 'showSubmittedLabel', submitted)).toBe(true);

    resetFakeCollections();
    const user = await loginAs('me');
    const game = await insertGame({ gamePhase: GameState.PHASE.PLAY });
    await insertPlayer(game._id, { userId: user._id });
    setRoute({ params: { _id: game._id } });
    const playing = await insertPlayer(game._id, { userId: 'them', submitted: true });
    expect(callHelper('playerStatus', 'showSubmittedLabel', playing)).toBe(false);
  });

  it('distinguishes an announced power down from an active one', async () => {
    const announced = await panelFor({ powerState: GameLogic.DOWN });
    expect(callHelper('playerStatus', 'powerDownPlayed', announced)).toBe(true);
    expect(callHelper('playerStatus', 'power', announced)).toBe('power down played');

    const off = await panelFor({ powerState: GameLogic.OFF });
    expect(callHelper('playerStatus', 'power', off)).toBe('powered down');
  });

  it('shows the out-of-game label for an eliminated player', async () => {
    const dead = await panelFor({ lives: 0 });

    expect(callHelper('playerStatus', 'showOutOfGameLabel', dead)).toBe(true);
  });
});

describe('card clicks', () => {
  it('places a hand card in the open slot and advances the selection', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await seat({ cards: { chosenCards: [E, E, E, E, E] } });

    // Blaze binds the clicked card's data context as `this`.
    templateEvent('card', 'click .available').call({ cardId: TURN_RIGHT, chosen: false });

    expect(call).toHaveBeenCalledWith('selectCard', game._id, TURN_RIGHT, 0);
    // Selection moved on, so the next click fills slot 1.
    expect(callHelper('card', 'isSelected', { slot: 1 })).toBe(true);
  });

  it('ignores a click on a card already in the register', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat();

    templateEvent('card', 'click .available').call({ cardId: TURN_RIGHT, chosen: true });

    expect(call).not.toHaveBeenCalled();
  });

  it('ignores clicks once the player has submitted', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({ player: { submitted: true } });

    templateEvent('card', 'click .available').call({ cardId: TURN_RIGHT, chosen: false });
    templateEvent('card', 'click .played').call({ slot: 0, locked: false });

    expect(call).not.toHaveBeenCalled();
  });

  it('pulls a card back out of a filled slot', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await seat({ cards: { chosenCards: [TURN_RIGHT, E, E, E, E] } });

    templateEvent('card', 'click .played').call({ slot: 0, locked: false });

    expect(call).toHaveBeenCalledWith('deselectCard', game._id, 0);
    expect(callHelper('card', 'isSelected', { slot: 0 })).toBe(true);
  });

  it('refuses to pull a card out of a locked slot', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({ cards: { chosenCards: [TURN_RIGHT, E, E, E, TURN_RIGHT] } });

    templateEvent('card', 'click .played').call({ slot: 4, locked: true });

    expect(call).not.toHaveBeenCalled();
  });

  it('moves the selection when an empty slot is clicked', async () => {
    await seat();

    templateEvent('card', 'click .empty').call({ slot: 3 });

    expect(callHelper('card', 'isSelected', { slot: 3 })).toBe(true);
    expect(callHelper('card', 'selected', { slot: 3 })).toBe('selected');
    expect(callHelper('card', 'selected', { slot: 0 })).toBe('');
  });
});
