// @vitest-environment jsdom
// The card panel: the phase heading and timer, the hand and registers, the auto-submit
// latch, and the rows for the other players. modalDialogs is mocked so the handlers' own
// decisions are what gets asserted. The inert `useTracker` stub reads the collections
// once per render, so a test that changes a document re-renders the panel itself.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.ts', () => ({
  modalAlert: vi.fn(),
  modalConfirm: vi.fn(async () => true),
}));

import { CardPanel } from '../../client/views/cards/CardPanel.tsx';
import { modalAlert } from '../../client/helper/modalDialogs.ts';
import { CardLogic } from '../../both/cardlogic.ts';
import { GameLogic } from '../../both/gamelogic.ts';
import { GameState } from '../../both/gamestate.ts';
import { Cards } from '../../collections/cards.ts';
import { Games } from '../../collections/games.ts';
import { insertCards, insertGame, insertPlayer } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { renderAt, resetRouter, setRoute } from '../helpers/router.tsx';

const E = CardLogic.EMPTY;
const TURN_RIGHT = 6;
const STEP_FORWARD = 48;
const FULL_HAND = [0, 6, 7, 24, 25, 42, 48, 49, 66];

type Overrides = Record<string, unknown>;

/** A live game with the caller seated in it, routed the way FlowRouter would have it. */
async function seat({
  game: gameOverrides = {},
  player: playerOverrides = {},
  cards = {},
}: { game?: Overrides; player?: Overrides; cards?: Overrides } = {}) {
  await loginAs('me');
  // The fixtures read the document straight back, so there is always one.
  const game = (await insertGame(gameOverrides))!;
  const player = (await insertPlayer(game._id, {
    userId: 'me',
    name: 'me',
    robotId: '0',
    ...playerOverrides,
  }))!;
  await insertCards(player._id, game._id, { userId: 'me', handCards: FULL_HAND, ...cards });
  setRoute(`/board/${game._id}`);
  return { game, player };
}

const heading = () => screen.getByRole('heading', { level: 3 });
const hand = () => document.querySelectorAll('.hand .gamecard');
const registers = () => document.querySelectorAll('.playing .gamecard');
const selectedSlot = () => [...registers()].findIndex((el) => el.classList.contains('selected'));
const playButton = () => screen.getByRole('link', { name: 'Play cards' });
const powerButton = () => screen.getByRole('button', { name: /power down/i });
const timerPill = () => screen.queryByLabelText(/seconds left/);
const countdownState = () => document.body.firstElementChild!.firstElementChild;

beforeEach(() => {
  resetFakeCollections();
  resetRouter();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('the heading', () => {
  it('renders nothing when the route points at no game', async () => {
    await loginAs('me');

    const { container } = renderAt(<CardPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [GameState.PHASE.IDLE, 'Dealing cards'],
    [GameState.PHASE.DEAL, 'Dealing cards'],
    [GameState.PHASE.ENDED, 'Game over'],
  ])('labels the %s phase "%s"', async (gamePhase, label) => {
    await seat({ game: { gamePhase } });

    renderAt(<CardPanel />);

    expect(heading()).toHaveTextContent(label);
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

    renderAt(<CardPanel />);

    expect(heading()).toHaveTextContent(label);
  });

  it('falls through to "Problem?" for a play phase with no label', async () => {
    // LASER_OPTIONS is in the PLAY_PHASE enum but missing from the switch.
    await seat({
      game: { gamePhase: GameState.PHASE.PLAY, playPhase: GameState.PLAY_PHASE.LASER_OPTIONS },
    });

    renderAt(<CardPanel />);

    expect(heading()).toHaveTextContent('Problem?');
  });

  describe('during programming', () => {
    it('tells a live player to pick cards', async () => {
      await seat();

      renderAt(<CardPanel />);

      expect(heading()).toHaveTextContent('Pick your cards');
    });

    it('says "No archives" once the player is out of lives', async () => {
      await seat({ player: { lives: 0 } });

      renderAt(<CardPanel />);

      expect(heading()).toHaveTextContent('No archives');
    });

    it('says "Powered down" for a powered-down player', async () => {
      await seat({ player: { powerState: GameLogic.OFF, optionalInstantPowerDown: false } });

      renderAt(<CardPanel />);

      expect(heading()).toHaveTextContent('Powered down');
    });

    // Still "Powered down" while the player may opt back in: the robot is down until
    // Cancel is pressed, and there are no cards to pick until then.
    it('says "Powered down" for a player who may still opt back in', async () => {
      await seat({ player: { powerState: GameLogic.OFF, optionalInstantPowerDown: true } });

      renderAt(<CardPanel />);

      expect(heading()).toHaveTextContent('Powered down');
    });

    it('says "Players thinking" to a spectator', async () => {
      const game = (await insertGame())!;
      await loginAs('watcher');
      setRoute(`/board/${game._id}`);

      renderAt(<CardPanel />);

      expect(heading()).toHaveTextContent('Players thinking');
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

      renderAt(<CardPanel />);

      expect(heading()).toHaveTextContent(label);
    });

    it('tells everyone else to wait', async () => {
      await seat({
        game: {
          gamePhase: GameState.PHASE.RESPAWN,
          respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
          respawnUserId: 'someone-else',
        },
      });

      renderAt(<CardPanel />);

      expect(heading()).toHaveTextContent('Waiting for destroyed bots to reenter');
    });
  });
});

describe('the hand and the registers', () => {
  it('shows the hand to a live, unsubmitted player during programming', async () => {
    await seat();

    renderAt(<CardPanel />);

    expect(screen.getByText('Your hand')).toBeInTheDocument();
    expect(screen.getByText('Registers')).toBeInTheDocument();
    expect(hand()).toHaveLength(9);
    expect(document.querySelectorAll('.hand .gamecard.available')).toHaveLength(9);
    expect(registers()).toHaveLength(5);
    expect(screen.getByText('Your robot')).toBeInTheDocument();
  });

  it.each([
    ['the player already submitted', { submitted: true }],
    ['the player has no lives left', { lives: 0 }],
  ])('shows the status row instead of the hand when %s', async (_label, playerOverrides) => {
    await seat({ player: playerOverrides });

    renderAt(<CardPanel />);

    expect(document.querySelector('.hand')).not.toBeInTheDocument();
    expect(document.querySelector('.player-robot')).toBeInTheDocument();
  });

  it('shows the status row outside the programming phase', async () => {
    await seat({
      game: { gamePhase: GameState.PHASE.PLAY },
      player: { cards: [TURN_RIGHT, CardLogic.COVERED, E, E, E] },
    });

    renderAt(<CardPanel />);

    expect(document.querySelector('.hand')).not.toBeInTheDocument();
    // The browser journey counts these to see a register resolve.
    expect(document.querySelectorAll('.player-robot .smallhand .gamecard.played')).toHaveLength(1);
  });

  it('pads the hand out to nine cards with slots lost to damage', async () => {
    await seat({ cards: { handCards: [TURN_RIGHT, STEP_FORWARD] } });

    renderAt(<CardPanel />);

    const cards = hand();
    expect(cards).toHaveLength(9);
    expect(cards[0]).toHaveClass('turn-right', 'available');
    expect([...cards].slice(2).every((el) => el.classList.contains('damage'))).toBe(true);
  });

  it('greys out a hand card already sitting in the register', async () => {
    await seat({
      cards: { handCards: [TURN_RIGHT, STEP_FORWARD], chosenCards: [STEP_FORWARD, E, E, E, E] },
    });

    renderAt(<CardPanel />);

    expect(hand()[0]).not.toHaveClass('chosen');
    expect(hand()[1]).toHaveClass('chosen');
    expect(registers()[0]).toHaveClass('step-forward', 'played');
  });

  it('renders the register with the locked tail and the cursor on the first empty slot', async () => {
    // lockedCnt() = max(0, 5 + damage - 9); damage 5 locks the last slot.
    await seat({
      player: { damage: 5 },
      cards: { chosenCards: [TURN_RIGHT, E, E, E, STEP_FORWARD] },
    });

    renderAt(<CardPanel />);

    expect(registers()[0]).toHaveClass('turn-right');
    expect(registers()[4]).toHaveClass('locked');
    expect(selectedSlot()).toBe(1);
  });

  // The stay-down choice has to be made blind, so neither the hand nor the registers are
  // on screen: the server deals nothing until the player cancels the power down.
  it('replaces the hand and the registers with a notice while the robot is powered down', async () => {
    await seat({ player: { powerState: GameLogic.OFF } });

    renderAt(<CardPanel />);

    expect(registers()).toHaveLength(0);
    expect(hand()).toHaveLength(0);
    expect(screen.getByText('Your robot is powered down')).toBeInTheDocument();
  });

  it('shows the option cards the player holds', async () => {
    await seat({ player: { optionCards: { extra_memory: true } } });

    renderAt(<CardPanel />);

    expect(screen.getByText('Option cards')).toBeInTheDocument();
    expect(screen.getByText(CardLogic.getOptionTitle('extra_memory'))).toHaveAttribute(
      'title',
      CardLogic.getOptionDesc('extra_memory')
    );
  });
});

const BACKGROUNDS = ['bg-transparent', 'bg-danger', 'bg-warning'];

describe('the buttons', () => {
  it.each([
    // Announced reads as danger, cancelled as a warning; only the idle button is a ghost.
    [GameLogic.ON, 'Announce', 'Announce power down', 'bg-transparent'],
    [GameLogic.DOWN, 'Withdraw', 'Withdraw power down', 'bg-danger'],
    [GameLogic.OFF, 'Cancel', 'Cancel power down', 'bg-warning'],
  ])('labels power state %s "%s"', async (powerState, verb, name, background) => {
    await seat({ player: { powerState } });

    renderAt(<CardPanel />);

    // The power symbol says "power down", so only the verb is written out — but the
    // accessible name is the whole wording.
    expect(powerButton()).toHaveTextContent(verb);
    expect(powerButton().querySelector('[data-icon="power"]')).toBeVisible();
    expect(powerButton()).toHaveAccessibleName(name);
    expect(powerButton().className).toContain(background);
    for (const other of BACKGROUNDS.filter((name) => name !== background)) {
      expect(powerButton().className).not.toContain(other);
    }
  });

  it('enables submit only once all five registers are filled', async () => {
    await seat({ player: { chosenCardsCnt: 4 } });
    const { unmount } = renderAt(<CardPanel />);
    expect(playButton()).toHaveClass('disabled');
    expect(playButton()).toHaveAttribute('aria-disabled', 'true');
    unmount();

    resetFakeCollections();
    await seat({ player: { chosenCardsCnt: 5 } });
    renderAt(<CardPanel />);
    expect(playButton()).not.toHaveClass('disabled');
    expect(playButton()).toHaveAttribute('aria-disabled', 'false');
  });

  it('enables submit for a powered-down player with an empty register', async () => {
    await seat({ player: { chosenCardsCnt: 0, powerState: GameLogic.OFF } });

    renderAt(<CardPanel />);

    expect(playButton()).not.toHaveClass('disabled');
  });

  it('submits the program, tagged with the current programming round', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await seat({ game: { programRound: 3 }, player: { chosenCardsCnt: 5 } });

    renderAt(<CardPanel />);
    fireEvent.click(playButton());

    expect(call).toHaveBeenCalledWith('playCards', { gameId: game._id, programRound: 3 });
  });

  it('does nothing when the disabled submit is clicked', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({ player: { chosenCardsCnt: 4 } });

    renderAt(<CardPanel />);
    fireEvent.click(playButton());

    expect(call).not.toHaveBeenCalled();
  });

  it('reports a refused submit', async () => {
    vi.spyOn(Meteor, 'callAsync').mockRejectedValue({
      reason: 'Not all program slots are filled.',
    });
    await seat({ player: { chosenCardsCnt: 5 } });

    renderAt(<CardPanel />);
    fireEvent.click(playButton());

    await vi.waitFor(() =>
      expect(modalAlert).toHaveBeenCalledWith('Not all program slots are filled.')
    );
  });

  it('toggles the power down', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(GameLogic.DOWN);
    const { game } = await seat();

    renderAt(<CardPanel />);
    fireEvent.click(powerButton());

    expect(call).toHaveBeenCalledWith('togglePowerDown', { gameId: game._id });
  });
});

describe('the lives and damage readout', () => {
  it('renders three hearts, filled up to the life count', async () => {
    await seat({ player: { lives: 2, damage: 4 } });

    renderAt(<CardPanel />);

    expect(screen.getByRole('img', { name: '2 of 3 lives' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-icon="heart"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-icon="heart-outline"]')).toHaveLength(1);
    expect(screen.getByText('40% damaged')).toBeInTheDocument();
  });
});

describe('the countdown', () => {
  const startedAgo = (seconds: number) => ({
    timer: 1,
    timerStartedAt: new Date(Date.now() - seconds * 1000),
  });

  beforeEach(() => vi.useFakeTimers());

  // The first reading is deferred a task, so the clock is a tick behind at mount.
  const firstTick = () => act(() => vi.advanceTimersByTime(0));

  it('counts down in the pill and in the cursor slot, and colours the panel', async () => {
    await seat({ game: startedAgo(10) });

    renderAt(<CardPanel />);
    firstTick();

    expect(timerPill()).toHaveTextContent(`${GameLogic.TIMER - 10}`);
    expect(registers()[0]).toHaveTextContent(`${GameLogic.TIMER - 10}`);
    expect(countdownState()).toHaveAttribute('data-countdown', 'running');
  });

  it('ticks once a second and stops when the panel goes away', async () => {
    await seat({ game: startedAgo(10) });

    const { unmount } = renderAt(<CardPanel />);
    firstTick();
    act(() => vi.advanceTimersByTime(2000));

    expect(timerPill()).toHaveTextContent(`${GameLogic.TIMER - 12}`);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts no clock while the timer is not running', async () => {
    await seat({ game: { timer: -1 } });

    renderAt(<CardPanel />);

    expect(vi.getTimerCount()).toBe(0);
    expect(timerPill()).not.toBeInTheDocument();
    expect(countdownState()).not.toHaveAttribute('data-countdown');
  });

  it('turns urgent in the last five seconds', async () => {
    await seat({ game: startedAgo(27) });

    renderAt(<CardPanel />);
    firstTick();

    expect(timerPill()).toHaveTextContent('3');
    expect(timerPill()).toHaveClass('animate-timer-pulse');
    expect(countdownState()).toHaveAttribute('data-countdown', 'urgent');
  });

  it('shows nothing to a player who is out of the game', async () => {
    await seat({ game: startedAgo(10), player: { lives: 0 } });

    renderAt(<CardPanel />);
    firstTick();

    expect(timerPill()).not.toBeInTheDocument();
    expect(countdownState()).not.toHaveAttribute('data-countdown');
  });

  it('keeps the pill but drops the panel colour once the player has submitted', async () => {
    await seat({ game: startedAgo(10), player: { submitted: true } });

    renderAt(<CardPanel />);
    firstTick();

    expect(timerPill()).toHaveTextContent(`${GameLogic.TIMER - 10}`);
    expect(countdownState()).not.toHaveAttribute('data-countdown');
  });
});

describe('the auto-submit', () => {
  it('submits, tagged with the current programming round, when the server timer reaches zero', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await seat({ game: { timer: 0, programRound: 3 } });

    renderAt(<CardPanel />);

    expect(call).toHaveBeenCalledWith('playCards', { gameId: game._id, programRound: 3 });
  });

  // Regression: the Blaze helper re-ran on every reactive invalidation while the timer sat
  // at 0, and every run used to fire another playCards. The duplicates queued behind the
  // first call — which only returns after the whole turn has played out — and then
  // executed against the NEXT turn's program phase, submitting five random cards. A React
  // re-render is the same window, and there are more of them.
  it('submits only once while the timer stays at zero, however often the panel renders', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({ game: { timer: 0 } });

    const { rerender } = renderAt(<CardPanel />);
    rerender(<CardPanel />);
    rerender(<CardPanel />);

    expect(call).toHaveBeenCalledTimes(1);
  });

  it('re-arms once the timer leaves zero', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await seat({ game: { timer: 0 } });

    const { rerender } = renderAt(<CardPanel />);
    await Games.updateAsync(game._id, { $set: { timer: -1 } });
    rerender(<CardPanel />);
    await Games.updateAsync(game._id, { $set: { timer: 0 } });
    rerender(<CardPanel />);

    expect(call).toHaveBeenCalledTimes(2);
  });

  it('does not submit for a player who already submitted', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({ game: { timer: 0 }, player: { submitted: true } });

    renderAt(<CardPanel />);

    expect(call).not.toHaveBeenCalled();
  });

  it('does not submit for a player who is out of the game', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({ game: { timer: 0 }, player: { lives: 0 } });

    renderAt(<CardPanel />);

    expect(call).not.toHaveBeenCalled();
  });

  it('does not submit on behalf of a spectator', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const game = (await insertGame({ timer: 0 }))!;
    await loginAs('watcher');
    setRoute(`/board/${game._id}`);

    renderAt(<CardPanel />);

    expect(call).not.toHaveBeenCalled();
  });
});

describe('the other players', () => {
  it('lists everyone but the caller, under a divider', async () => {
    const { game } = await seat();
    await insertPlayer(game._id, { userId: 'them', name: 'them', robotId: '1' });

    renderAt(<CardPanel />);

    const rows = document.querySelectorAll('.other-robot');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('them');
    expect(document.querySelectorAll('hr.star-well')).toHaveLength(2);
  });

  it('lists nobody as "other" for a spectator, and draws no divider', async () => {
    const game = (await insertGame())!;
    await insertPlayer(game._id, { userId: 'them', name: 'them', robotId: '1' });
    await loginAs('watcher');
    setRoute(`/board/${game._id}`);

    renderAt(<CardPanel />);

    expect(document.querySelectorAll('.other-robot')).toHaveLength(1);
    expect(document.querySelector('.player-robot')).not.toBeInTheDocument();
    expect(document.querySelectorAll('hr.star-well')).toHaveLength(1);
  });
});

describe('card clicks', () => {
  it('places a hand card in the cursor slot and advances the cursor', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await seat();

    renderAt(<CardPanel />);
    expect(selectedSlot()).toBe(0);
    fireEvent.click(hand()[1]);

    expect(call).toHaveBeenCalledWith('selectCard', {
      gameId: game._id,
      card: TURN_RIGHT,
      index: 0,
    });
    // The cursor moved on, so the next click fills slot 1.
    expect(selectedSlot()).toBe(1);
  });

  it('ignores a click on a hand card already in the register', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({ cards: { chosenCards: [TURN_RIGHT, E, E, E, E] } });

    renderAt(<CardPanel />);
    fireEvent.click(hand()[1]);

    expect(call).not.toHaveBeenCalled();
    expect(selectedSlot()).toBe(1);
  });

  it('ignores a hand click while the cursor sits on a filled slot', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({ cards: { chosenCards: [TURN_RIGHT, E, E, E, E] } });

    renderAt(<CardPanel />);
    // Pulling the card out parks the cursor on slot 0; the stub writes nothing back, so
    // the data still says the slot is filled — the state a slow round trip leaves behind.
    // Had the cursor stayed on slot 1, the hand click below would have filled it.
    fireEvent.click(registers()[0]);
    call.mockClear();

    fireEvent.click(hand()[2]);

    expect(call).not.toHaveBeenCalled();
  });

  it('pulls a card back out of a filled slot and parks the cursor there', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game, player } = await seat({ cards: { chosenCards: [E, STEP_FORWARD, E, E, E] } });

    const { rerender } = renderAt(<CardPanel />);
    expect(selectedSlot()).toBe(0);
    fireEvent.click(registers()[1]);

    expect(call).toHaveBeenCalledWith('deselectCard', { gameId: game._id, index: 1 });
    // The slot shows the cursor once the write lands — slot 1, where the click was, not
    // slot 0, which is where the first empty slot would have put it.
    await Cards.updateAsync({ playerId: player._id }, { $set: { chosenCards: [E, E, E, E, E] } });
    rerender(<CardPanel />);
    expect(selectedSlot()).toBe(1);
  });

  it('refuses to pull a card out of a locked slot', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat({
      player: { damage: 5 },
      cards: { chosenCards: [TURN_RIGHT, E, E, E, TURN_RIGHT] },
    });

    renderAt(<CardPanel />);
    fireEvent.click(registers()[4]);

    expect(call).not.toHaveBeenCalled();
  });

  it('moves the cursor when an empty slot is clicked', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await seat();

    renderAt(<CardPanel />);
    fireEvent.click(registers()[3]);

    expect(selectedSlot()).toBe(3);
    expect(call).not.toHaveBeenCalled();
  });

  // The `card` template served every player's small hand as well as the caller's own, so
  // its handlers fired for an onlooker with no `Players` row and read `.submitted` off an
  // undefined player. There is no handler on a small-hand card now; this pins that.
  it('does nothing for an onlooker who is not in the game', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const game = (await insertGame())!;
    const other = (await insertPlayer(game._id, {
      userId: 'someone-else',
      name: 'them',
      robotId: '1',
      cards: [TURN_RIGHT, E, E, E, E],
    }))!;
    await insertCards(other._id, game._id, { userId: 'someone-else' });
    await loginAs('onlooker');
    setRoute(`/board/${game._id}`);

    renderAt(<CardPanel />);
    const theirs = document.querySelectorAll('.other-robot .smallhand .gamecard');
    expect(theirs).toHaveLength(5);
    expect(() => {
      fireEvent.click(theirs[0]);
      fireEvent.click(theirs[1]);
    }).not.toThrow();

    expect(call).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // The other half of the same problem: a seated player clicking a card in somebody
  // else's small hand used to move their own cursor, or send a deselect for slot
  // `undefined`.
  it("does nothing for a seated player clicking another player's cards", async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await seat({ cards: { chosenCards: [TURN_RIGHT, E, E, E, E] } });
    await insertPlayer(game._id, {
      userId: 'someone-else',
      name: 'them',
      robotId: '1',
      cards: [STEP_FORWARD, E, E, E, E],
    });

    renderAt(<CardPanel />);
    expect(selectedSlot()).toBe(1);

    const theirs = document.querySelectorAll('.other-robot .smallhand .gamecard');
    fireEvent.click(theirs[0]);
    fireEvent.click(theirs[1]);

    expect(call).not.toHaveBeenCalled();
    expect(selectedSlot()).toBe(1);
  });
});
