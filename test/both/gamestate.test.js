import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { insertGame, insertPlayer, insertCards, insertDeck } from '../helpers/fixtures.js';
import { GameState, setBuildHighscores } from '../../both/gamestate.js';
import { GameLogic } from '../../both/gamelogic.js';
import { CardLogic } from '../../both/cardlogic.js';
import { Board } from '../../both/board.js';
import { BoardBox } from '../../both/board_box.js';
import { Games } from '../../collections/games.js';
import { Players } from '../../collections/players.js';
import { Cards } from '../../collections/cards.js';
import { Chat } from '../../collections/chat.js';
import { Deck } from '../../collections/deck.js';

function stubBoard(width = 6, height = 6) {
  const board = new Board('gamestate-test', 1, 8, width, height);
  // An unreachable-by-default checkpoint, so a fresh player's `visited_checkpoints`
  // (0) never accidentally equals `board.checkpoints.length` (which would otherwise
  // be 0 on a bare board and immediately "win" the game in checkIfWeHaveAWinner).
  board.checkpoints = [{ x: -1, y: -1, number: 1 }];
  vi.spyOn(BoardBox, 'getBoard').mockReturnValue(board);
  return board;
}

// GameState's phase-dispatch methods (nextGamePhaseAsync/nextPlayPhaseAsync) often
// end by recursively calling themselves to advance to the next phase. Letting that
// recursion run for real would cascade into the entire rest of the game loop, so this
// lets exactly the first (real, under-test) call through and swallows any further
// recursive call the phase handler makes at the end.
function guardRecursion(methodName) {
  const original = GameState[methodName].bind(GameState);
  const spy = vi.spyOn(GameState, methodName).mockImplementation(async (...args) => {
    if (spy.mock.calls.length === 1) return original(...args);
    return undefined;
  });
  return spy;
}

beforeEach(() => {
  resetFakeCollections();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('nextGamePhaseAsync: IDLE -> DEAL', () => {
  it('marks the game started and runs a deal phase for a normal player', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.IDLE });
    const player = await insertPlayer(game._id, { damage: 2 });
    await insertCards(player._id, game._id, {
      handCards: [1, 2],
      chosenCards: [3, 4, -1, -1, -1],
    });
    await insertDeck(game._id, { cards: Array.from({ length: 30 }, (_, i) => i) });
    guardRecursion('nextGamePhaseAsync');

    const p = GameState.nextGamePhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.started).toBe(true);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.PROGRAM);
    // Each deal opens a new programming round; playCards uses this to reject a
    // submit that arrives after the turn it was meant for.
    expect(gameDoc.programRound).toBe(2); // fixture seeds 1

    const playerDoc = await Players.findOneAsync(player._id);
    expect(playerDoc.playedCardsCnt).toBe(0);
    expect(playerDoc.submitted).toBe(false);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.handCards).toHaveLength(7); // 9 - damage(2)
    expect(cardsDoc.chosenCards).toEqual([-1, -1, -1, -1, -1]); // old selection discarded
  });

  it('circuit_breaker at 3+ damage powers the robot fully OFF for the turn being dealt, announcing the trigger and the discard in chat', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.IDLE });
    const player = await insertPlayer(game._id, {
      damage: 3,
      powerState: GameLogic.ON,
      optionCards: { circuit_breaker: true },
    });
    await insertCards(player._id, game._id);
    await insertDeck(game._id, { cards: [1, 2, 3], optionCards: [], discardedOptionCards: [] });
    guardRecursion('nextGamePhaseAsync');

    const p = GameState.nextGamePhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    // The circuit_breaker check and the DOWN->OFF transition both run in the same
    // per-player pass of playDealPhase, with no turn boundary between them: setting
    // powerState to DOWN immediately falls through into the `else if (... === DOWN)`
    // branch right below it, which flips it straight to OFF and auto-submits.
    const playerDoc = await Players.findOneAsync(player._id);
    expect(playerDoc.powerState).toBe(GameLogic.OFF);
    expect(playerDoc.submitted).toBe(true);
    expect(playerDoc.damage).toBe(0);
    expect(playerDoc.optionCards.circuit_breaker).toBeUndefined();
    const deckDoc = await Deck.findOneAsync({ gameId: game._id });
    expect(deckDoc.discardedOptionCards).toContain(CardLogic.getOptionId('circuit_breaker'));
    // All three facts land in the same deal pass, far too fast to follow from the UI,
    // so each must leave a chat line.
    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages).toContain('bot powers down — Circuit Breaker triggered at 30%+ damage');
    expect(messages).toContain('bot discarded option card Circuit Breaker');
    expect(messages).toContain('bot is powered down this turn');
  });

  it('a player who announced power-down goes OFF, auto-submits with 0 damage, and is dealt no cards', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.IDLE });
    const player = await insertPlayer(game._id, {
      damage: 6,
      powerState: GameLogic.DOWN,
      optionalInstantPowerDown: false,
    });
    await insertCards(player._id, game._id);
    await insertDeck(game._id, { cards: [1, 2, 3] });
    guardRecursion('nextGamePhaseAsync');

    const p = GameState.nextGamePhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const playerDoc = await Players.findOneAsync(player._id);
    expect(playerDoc.powerState).toBe(GameLogic.OFF);
    expect(playerDoc.submitted).toBe(true);
    expect(playerDoc.damage).toBe(0);
    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.handCards).toEqual([]);
    // The only prior trace of any power-down was the panel badge; the moment it takes
    // effect now reaches the chat history too.
    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages).toContain('bot is powered down this turn');
  });

  it('auto-advances past PROGRAM when every living player ends the deal phase already submitted', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.IDLE });
    const player = await insertPlayer(game._id, { powerState: GameLogic.DOWN });
    await insertCards(player._id, game._id);
    await insertDeck(game._id, { cards: [1, 2, 3] });
    const spy = guardRecursion('nextGamePhaseAsync');

    const p = GameState.nextGamePhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    // once for the real IDLE->DEAL call, once more because the deal phase found
    // nobody left to wait on and advanced again on its own.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('nextGamePhaseAsync: PROGRAM -> PLAY', () => {
  it('announces, then starts register 1 of the play phase', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
    vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();

    const p = GameState.nextGamePhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.announce).toBe(true);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.PLAY);
    expect(gameDoc.playPhase).toBe(GameState.PLAY_PHASE.IDLE);
    expect(gameDoc.playPhaseCount).toBe(1);
    expect(GameState.nextPlayPhaseAsync).toHaveBeenCalledWith(game._id);
  });
});

describe('nextPlayPhaseAsync: REVEAL_CARDS', () => {
  it('reveals the current register slot only for active players', async () => {
    stubBoard();
    const game = await insertGame({ playPhase: GameState.PLAY_PHASE.REVEAL_CARDS });
    const active = await insertPlayer(game._id, { playedCardsCnt: 2, cards: [-2, -2, -2, -2, -2] });
    const poweredDown = await insertPlayer(game._id, {
      powerState: GameLogic.OFF,
      playedCardsCnt: 2,
      cards: [-2, -2, -2, -2, -2],
    });
    await insertCards(active._id, game._id, { chosenCards: [10, 11, 42, 13, 14] });
    await insertCards(poweredDown._id, game._id, { chosenCards: [20, 21, 22, 23, 24] });
    guardRecursion('nextPlayPhaseAsync');

    const p = GameState.nextPlayPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const activeDoc = await Players.findOneAsync(active._id);
    expect(activeDoc.cards[2]).toBe(42); // register slot 2 revealed from chosenCards[2]

    const poweredDownDoc = await Players.findOneAsync(poweredDown._id);
    expect(poweredDownDoc.cards[2]).toBe(-2); // untouched: not active
  });
});

describe('nextPlayPhaseAsync: MOVE_BOTS', () => {
  it('plays cards in descending id order (matching card priority) and skips a respawning player', async () => {
    stubBoard();
    const game = await insertGame({ playPhase: GameState.PLAY_PHASE.MOVE_BOTS });
    const low = await insertPlayer(game._id, { playedCardsCnt: 0, direction: GameLogic.UP });
    const high = await insertPlayer(game._id, { playedCardsCnt: 0, direction: GameLogic.UP });
    const respawning = await insertPlayer(game._id, { needsRespawn: true, playedCardsCnt: 0 });
    await insertCards(low._id, game._id, { chosenCards: [6, -1, -1, -1, -1] }); // turn-right
    await insertCards(high._id, game._id, { chosenCards: [24, -1, -1, -1, -1] }); // turn-left
    await insertCards(respawning._id, game._id, { chosenCards: [6, -1, -1, -1, -1] });
    const playOrder = [];
    vi.spyOn(GameLogic, 'playCard').mockImplementation(async (player) => {
      playOrder.push(player._id);
    });
    guardRecursion('nextPlayPhaseAsync');

    const p = GameState.nextPlayPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    // higher card id (24, turn-left) has higher priority and plays first
    expect(playOrder).toEqual([high._id, low._id]);
    expect(playOrder).not.toContain(respawning._id);
  });
});

describe('checkIfWeHaveAWinner (via CHECKPOINTS)', () => {
  it('declares a winner once a player visits the final checkpoint, and calls buildHighscores', async () => {
    const board = stubBoard();
    board.checkpoints = [{ x: 0, y: 0, number: 1 }]; // single-checkpoint course
    board.getTile(0, 0).checkpoint = 1;
    const game = await insertGame({
      playPhase: GameState.PLAY_PHASE.CHECKPOINTS,
      playPhaseCount: 1,
    });
    const winner = await insertPlayer(game._id, {
      name: 'winner',
      userId: 'winner_account',
      position: { x: 0, y: 0 },
      visited_checkpoints: 0,
    });
    const highscores = vi.fn().mockResolvedValue();
    setBuildHighscores(highscores);

    const p = GameState.nextPlayPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(gameDoc.winner).toBe('winner');
    // The name is for the board; the userId is what server/highscores.js groups on.
    expect(gameDoc.winnerUserId).toBe(winner.userId);
    expect(highscores).toHaveBeenCalled();
    const winnerDoc = await Players.findOneAsync(winner._id);
    expect(winnerDoc.visited_checkpoints).toBe(1);
    setBuildHighscores(async () => {});
  });

  it('declares "Nobody" the winner when every player has run out of lives', async () => {
    stubBoard();
    const game = await insertGame({
      playPhase: GameState.PLAY_PHASE.CHECKPOINTS,
      playPhaseCount: 1,
    });
    await insertPlayer(game._id, { lives: 0 });
    await insertPlayer(game._id, { lives: 0 });

    const p = GameState.nextPlayPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(gameDoc.winner).toBe('Nobody');
    // No winnerUserId: its absence is what keeps this game out of the ranking.
    expect(gameDoc.winnerUserId).toBeUndefined();
  });

  it('declares the last robot standing the winner when only one of several players has lives left', async () => {
    stubBoard();
    const game = await insertGame({
      playPhase: GameState.PLAY_PHASE.CHECKPOINTS,
      playPhaseCount: 1,
    });
    const survivor = await insertPlayer(game._id, {
      name: 'survivor',
      userId: 'survivor_account',
      lives: 1,
    });
    await insertPlayer(game._id, { userId: 'other_account', lives: 0 });

    const p = GameState.nextPlayPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(gameDoc.winner).toBe(survivor.name);
    expect(gameDoc.winnerUserId).toBe(survivor.userId);
  });

  it('loops back to REVEAL_CARDS (incrementing playPhaseCount) when nobody has won and fewer than 5 registers have played', async () => {
    stubBoard();
    const game = await insertGame({
      playPhase: GameState.PLAY_PHASE.CHECKPOINTS,
      playPhaseCount: 3,
    });
    await insertPlayer(game._id);
    guardRecursion('nextPlayPhaseAsync');

    const p = GameState.nextPlayPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.playPhaseCount).toBe(4);
  });
});

describe('respawn phase: choosing a position', () => {
  it("offers every radius-1 tile (including the robot's own start tile) that isn't occupied or a void", async () => {
    const board = stubBoard();
    const game = await insertGame({ respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION });
    const player = await insertPlayer(game._id, { start: { x: 2, y: 2 } });
    await Games.updateAsync(game._id, { $set: { respawnPlayerId: player._id } });
    board.getTile(2, 1).type = 'void'; // one of the 9 (3x3, center included) is a pit

    const p = GameState.nextRespawnPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    // radius 1 means the full 3x3 block around start, NOT excluding the start tile
    // itself (r=1's dx/dy loop has no r>1 guard) -> 9 candidates, minus 1 void.
    expect(gameDoc.selectOptions).toHaveLength(8);
    expect(gameDoc.selectOptions).toContainEqual({ x: 2, y: 2 }); // the start tile itself
    expect(gameDoc.selectOptions).not.toContainEqual({ x: 2, y: 1 });
  });

  it('expands outward ring by ring (house rule) when every radius-1 square, including the start tile, is blocked', async () => {
    const board = stubBoard();
    const game = await insertGame({ respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION });
    const player = await insertPlayer(game._id, { start: { x: 2, y: 2 } });
    await Games.updateAsync(game._id, { $set: { respawnPlayerId: player._id } });
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        board.getTile(2 + dx, 2 + dy).type = 'void';
      }
    }

    const p = GameState.nextRespawnPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.selectOptions.length).toBeGreaterThan(0);
    // every offered square is strictly radius >= 2 away (Chebyshev distance)
    for (const opt of gameDoc.selectOptions) {
      const dist = Math.max(Math.abs(opt.x - 2), Math.abs(opt.y - 2));
      expect(dist).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('respawn phase: choosing a direction', () => {
  it('offers all 4 directions when the robot respawned exactly on its start tile', async () => {
    stubBoard();
    const game = await insertGame({ respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_DIRECTION });
    const player = await insertPlayer(game._id, {
      start: { x: 2, y: 2 },
      position: { x: 2, y: 2 },
    });
    await Games.updateAsync(game._id, { $set: { respawnPlayerId: player._id } });

    const p = GameState.nextRespawnPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.selectOptions).toHaveLength(4);
  });

  it('offers a direction only when its next 3 tiles are unoccupied, once the robot moved off its start tile', async () => {
    const board = stubBoard(10, 10);
    void board;
    const game = await insertGame({ respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_DIRECTION });
    const player = await insertPlayer(game._id, {
      start: { x: 5, y: 5 },
      position: { x: 5, y: 5 }, // still needs `start.x !== x && start.y !== y` to differ...
    });
    // Move the respawn candidate off its start tile in both axes, matching the
    // condition that switches on the restricted (line-of-sight) direction check.
    await Players.updateAsync(player._id, { $set: { position: { x: 6, y: 6 } } });
    const blocker = await insertPlayer(game._id, { position: { x: 6, y: 4 } }); // 2 tiles UP
    await Games.updateAsync(game._id, { $set: { respawnPlayerId: player._id } });

    const p = GameState.nextRespawnPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    // UP is blocked (a robot sits 2 tiles up); RIGHT/DOWN/LEFT have 3 clear tiles.
    expect(gameDoc.selectOptions).toHaveLength(3);
    expect(gameDoc.selectOptions.map((o) => o.dir)).not.toContain(GameLogic.UP);
    void blocker;
  });
});
