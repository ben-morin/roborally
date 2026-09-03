import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { insertGame, insertPlayer, insertCards, insertDeck } from '../helpers/fixtures.js';
import { GameState, setBuildHighscores } from '../../both/gamestate.ts';
import { GameLogic } from '../../both/gamelogic.ts';
import { CardLogic } from '../../both/cardlogic.ts';
import { Games } from '../../collections/games.ts';
import { Players } from '../../collections/players.ts';
import { Cards } from '../../collections/cards.ts';
import { Chat } from '../../collections/chat.ts';
import { Decks } from '../../collections/deck.ts';
import { stubBoard } from '../helpers/board.js';

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
    // Two claims: IDLE -> DEAL, then DEAL -> PROGRAM.
    expect(gameDoc.step).toBe(2);
    expect(gameDoc.lastStepAt).toBeInstanceOf(Date);

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
    const deckDoc = await Decks.findOneAsync({ gameId: game._id });
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
    // The name is for the board; the userId is what server/highscores.ts groups on.
    expect(gameDoc.winnerUserId).toBe(winner.userId);
    expect(highscores).toHaveBeenCalled();
    const winnerDoc = await Players.findOneAsync(winner._id);
    expect(winnerDoc.visited_checkpoints).toBe(1);
    setBuildHighscores(async () => {});
  });

  // The single-player test above cannot catch this: the elimination branch needs
  // `players.length > 1` to be reachable at all.
  it('announces a multi-player checkpoint win once, not again as the last robot standing', async () => {
    const board = stubBoard();
    board.checkpoints = [{ x: 0, y: 0, number: 1 }];
    board.getTile(0, 0).checkpoint = 1;
    const game = await insertGame({
      playPhase: GameState.PLAY_PHASE.CHECKPOINTS,
      playPhaseCount: 1,
    });
    // The winner is inserted first, so the `break` happens before the second player is
    // ever counted — which is the whole condition. Both are alive.
    const winner = await insertPlayer(game._id, {
      name: 'winner',
      userId: 'winner_account',
      position: { x: 0, y: 0 },
      visited_checkpoints: 0,
      lives: 3,
    });
    await insertPlayer(game._id, {
      name: 'runner_up',
      userId: 'runner_up_account',
      position: { x: 5, y: 5 },
      lives: 3,
    });
    const highscores = vi.fn().mockResolvedValue();
    setBuildHighscores(highscores);

    const p = GameState.nextPlayPhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await p;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(gameDoc.winner).toBe('winner');
    expect(gameDoc.winnerUserId).toBe(winner.userId);

    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages.filter((m) => m.includes('won the game'))).toEqual([
      'Player winner won the game!!',
    ]);
    // A full rebuild is idempotent, so a second call was invisible in the database and
    // only showed up as a doubled 'Building Highscores' in the server log.
    expect(highscores).toHaveBeenCalledTimes(1);
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

// Every write in the chain is a claim on the game's `step`; these pin what that buys.
describe('claims: one driver per game', () => {
  async function drive(fn) {
    const p = fn();
    await vi.runAllTimersAsync();
    await p;
  }

  it('two drivers entering PLAY together start it once', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
    vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();
    const updates = vi.spyOn(Games, 'updateAsync');

    await drive(() =>
      Promise.all([GameState.nextGamePhaseAsync(game._id), GameState.nextGamePhaseAsync(game._id)])
    );

    const playWrites = updates.mock.calls.filter(
      ([, modifier]) => modifier.$set?.gamePhase === GameState.PHASE.PLAY
    );
    expect(playWrites).toHaveLength(1);
    expect(GameState.nextPlayPhaseAsync).toHaveBeenCalledTimes(1);
    // announce + PLAY, once each; the loser wrote nothing.
    expect((await Games.findOneAsync(game._id)).step).toBe(2);
  });

  it('a driver whose first claim loses stops there and changes nothing', async () => {
    stubBoard();
    const game = await insertGame({ playPhase: GameState.PLAY_PHASE.REVEAL_CARDS });
    const player = await insertPlayer(game._id, { playedCardsCnt: 0, cards: [-2, -2, -2, -2, -2] });
    await insertCards(player._id, game._id, { chosenCards: [10, 11, 12, 13, 14] });
    // Another driver claims between this one's read and its first write.
    const read = Games.findOneAsync.bind(Games);
    vi.spyOn(Games, 'findOneAsync').mockImplementationOnce(async (...args) => {
      const stale = await read(...args);
      await Games.updateAsync(stale._id, { $inc: { step: 1 } });
      return stale;
    });
    const dispatch = guardRecursion('nextPlayPhaseAsync');

    await drive(() => GameState.nextPlayPhaseAsync(game._id));

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.playPhase).toBe(GameState.PLAY_PHASE.REVEAL_CARDS); // MOVE_BOTS never landed
    expect(gameDoc.step).toBe(1); // only the other driver's claim
    expect((await Players.findOneAsync(player._id)).cards[0]).toBe(-2); // no reveal
    expect(dispatch).toHaveBeenCalledTimes(1); // and no recursion into the next phase
  });

  it('the PLAY -> RESPAWN handoff records that no robot has been picked yet', async () => {
    stubBoard();
    const game = await insertGame({
      gamePhase: GameState.PHASE.PLAY,
      waitingForRespawn: ['p_a', 'p_b'],
      respawnPlayerId: 'left over from the previous respawn',
    });
    guardRecursion('nextGamePhaseAsync');

    await drive(() => GameState.nextGamePhaseAsync(game._id));

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.RESPAWN);
    expect(gameDoc.waitingForRespawn).toEqual(['p_b', 'p_a']);
    expect(gameDoc.respawnPlayerId).toBeNull();
  });

  it('picking the next robot clears the previous options before its own are computed', async () => {
    stubBoard();
    const game = await insertGame({
      gamePhase: GameState.PHASE.RESPAWN,
      selectOptions: [{ x: 0, y: 0 }],
      respawnUserId: 'previous robot owner',
    });
    const dead = await insertPlayer(game._id, {
      needsRespawn: true,
      start: { x: 2, y: 2 },
      position: { x: 5, y: 6 },
    });
    await Games.updateAsync(game._id, { $set: { waitingForRespawn: [dead._id] } });
    vi.spyOn(GameState, 'nextRespawnPhaseAsync').mockResolvedValue();

    await drive(() => GameState.nextGamePhaseAsync(game._id));

    expect(await Games.findOneAsync(game._id)).toMatchObject({
      respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_DIRECTION,
      respawnPlayerId: dead._id,
      waitingForRespawn: [],
      selectOptions: null,
      respawnUserId: null,
    });
  });
});

// The claim that enters a segment stores the players, cards and deck of that moment on the
// game document, and resumeAsync puts them back before it runs the segment again.
describe('segment snapshots', () => {
  async function drive(fn) {
    const p = fn();
    await vi.runAllTimersAsync();
    await p;
  }

  it('entering PLAY stores a play snapshot of the players, cards and deck', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
    const player = await insertPlayer(game._id, { damage: 3, powerState: GameLogic.DOWN });
    await insertCards(player._id, game._id, { handCards: [1, 2], chosenCards: [3, 4, 5, 6, 7] });
    await insertDeck(game._id, { cards: [8, 9] });
    vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();

    await drive(() => GameState.nextGamePhaseAsync(game._id));

    const { segmentSnapshot } = await Games.findOneAsync(game._id);
    expect(segmentSnapshot.segment).toBe(GameState.PHASE.PLAY);
    expect(segmentSnapshot.takenAt).toBeInstanceOf(Date);
    expect(segmentSnapshot.players).toHaveLength(1);
    expect(segmentSnapshot.players[0]).toMatchObject({
      _id: player._id,
      damage: 3,
      powerState: GameLogic.DOWN,
    });
    expect(segmentSnapshot.cards).toEqual([
      expect.objectContaining({ playerId: player._id, handCards: [1, 2] }),
    ]);
    expect(segmentSnapshot.deck).toMatchObject({ gameId: game._id, cards: [8, 9] });
  });

  it.each([
    [
      'IDLE (startGame)',
      { gamePhase: GameState.PHASE.IDLE },
      (game) => GameState.nextGamePhaseAsync(game._id),
    ],
    [
      'PLAY after repairs, nobody to respawn',
      { gamePhase: GameState.PHASE.PLAY, waitingForRespawn: [] },
      (game) => GameState.nextGamePhaseAsync(game._id),
    ],
    [
      'RESPAWN once the queue is empty',
      { gamePhase: GameState.PHASE.RESPAWN, waitingForRespawn: [] },
      (game) => GameState.nextGamePhaseAsync(game._id),
    ],
  ])('entering DEAL from %s stores a deal snapshot', async (_from, seed, enter) => {
    stubBoard();
    const game = await insertGame(seed);
    const player = await insertPlayer(game._id, { powerState: GameLogic.DOWN });
    await insertCards(player._id, game._id);
    await insertDeck(game._id, { cards: [1, 2, 3] });
    guardRecursion('nextGamePhaseAsync');

    await drive(() => enter(game));

    const { segmentSnapshot } = await Games.findOneAsync(game._id);
    expect(segmentSnapshot.segment).toBe(GameState.PHASE.DEAL);
    expect(segmentSnapshot.players[0]).toMatchObject({
      _id: player._id,
      powerState: GameLogic.DOWN,
    });
  });

  it('a claim that does not enter a segment leaves the snapshot as it is', async () => {
    const game = await insertGame({
      gamePhase: GameState.PHASE.PLAY,
      segmentSnapshot: { segment: GameState.PHASE.PLAY, players: [], cards: [], deck: null },
    });

    await game.setPlayPhaseAsync(GameState.PLAY_PHASE.MOVE_BOTS);
    await game.advanceAsync({ $set: { gamePhase: GameState.PHASE.ENDED } });

    expect((await Games.findOneAsync(game._id)).segmentSnapshot.segment).toBe(GameState.PHASE.PLAY);
  });
});

describe('resumeAsync', () => {
  const RESUME_CHAT = 'Server restarted — replaying this turn from the start';

  async function drive(fn) {
    const p = fn();
    await vi.runAllTimersAsync();
    await p;
  }

  // Everything the turn can change, minus the claim bookkeeping. Chat is left out: a
  // replayed turn repeats its lines, and the resume announces itself.
  async function finalState() {
    const games = (await Games.find().fetchAsync()).map(
      // eslint-disable-next-line no-unused-vars
      ({ step, lastStepAt, segmentSnapshot, ...rest }) => ({ ...rest })
    );
    const plain = (docs) => docs.map((doc) => ({ ...doc }));
    return {
      games,
      players: plain(await Players.find().fetchAsync()),
      cards: plain(await Cards.find().fetchAsync()),
      deck: plain(await Decks.find().fetchAsync()),
    };
  }

  // Two robots in one row, facing each other, every card in. Steps and turns move them
  // around, they push and shoot each other, nobody dies, no checkpoint is reached: the
  // turn ends in REPAIRS with positions, directions and damage all changed.
  async function seedFacingRobots() {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
    const a = await insertPlayer(game._id, {
      name: 'a',
      userId: 'a',
      position: { x: 1, y: 2 },
      direction: GameLogic.RIGHT,
      submitted: true,
      cards: [-2, -2, -2, -2, -2],
    });
    const b = await insertPlayer(game._id, {
      name: 'b',
      userId: 'b',
      position: { x: 4, y: 2 },
      direction: GameLogic.LEFT,
      submitted: true,
      cards: [-2, -2, -2, -2, -2],
    });
    // step, step, turn-left, u-turn, step / step, turn-right, step, turn-left, step
    await insertCards(a._id, game._id, {
      handCards: [60, 61, 62, 63],
      chosenCards: [48, 50, 24, 0, 52],
    });
    await insertCards(b._id, game._id, { handCards: [70, 71], chosenCards: [49, 7, 51, 25, 53] });
    await insertDeck(game._id, { cards: Array.from({ length: 20 }, (_, i) => i) });
    // The turn ends in playRepairs -> nextGamePhaseAsync, which would deal the next turn.
    guardRecursion('nextGamePhaseAsync');
    return game;
  }

  it('replays a turn cut off mid-register to the same end state as an uninterrupted run', async () => {
    // Reference: the whole turn, undisturbed.
    let game = await seedFacingRobots();
    await drive(() => GameState.nextGamePhaseAsync(game._id));
    const reference = await finalState();
    expect(reference.games[0]).toMatchObject({
      gamePhase: GameState.PHASE.PLAY,
      playPhase: GameState.PLAY_PHASE.REPAIRS,
      playPhaseCount: 5,
    });
    // Sanity: the turn did something to compare.
    expect(reference.players.map((p) => p.position)).not.toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(reference.players.map((p) => p.damage)).toEqual([1, 2]);

    // Same seed, but the process dies as register 3's lasers fire: registers 1-2 have run
    // in full, register 3's moves have landed, and the game document already says
    // CHECKPOINTS (it is written before the lasers).
    resetFakeCollections();
    vi.restoreAllMocks();
    game = await seedFacingRobots();
    const realLasers = GameLogic.executeLasers;
    let laserPhases = 0;
    const lasers = vi.spyOn(GameLogic, 'executeLasers').mockImplementation(async (players) => {
      if (++laserPhases === 3) throw new Error('simulated crash: register 3 lasers');
      return realLasers(players);
    });
    const crashed = GameState.nextGamePhaseAsync(game._id).catch((err) => err);
    await vi.runAllTimersAsync();
    expect(await crashed).toEqual(new Error('simulated crash: register 3 lasers'));
    lasers.mockRestore();
    const frozen = await Games.findOneAsync(game._id);
    expect(frozen.playPhaseCount).toBe(3);
    expect(frozen.playPhase).toBe(GameState.PLAY_PHASE.CHECKPOINTS);

    await drive(() => GameState.resumeAsync(game._id));

    expect(await finalState()).toEqual(reference);
    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages.filter((m) => m === RESUME_CHAT)).toHaveLength(1);
  });

  it('re-deals a deal cut off half-way, losing no card', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PLAY, waitingForRespawn: [] });
    const a = await insertPlayer(game._id, { userId: 'a', submitted: true });
    const b = await insertPlayer(game._id, { userId: 'b', submitted: true });
    await insertCards(a._id, game._id, { handCards: [60, 61], chosenCards: [1, 2, 3, 4, 5] });
    await insertCards(b._id, game._id, { handCards: [70], chosenCards: [6, 7, 8, 9, 10] });
    const deckCards = Array.from({ length: 20 }, (_, i) => 100 + i);
    await insertDeck(game._id, { cards: deckCards });
    const everyCard = [...deckCards, 60, 61, 1, 2, 3, 4, 5, 70, 6, 7, 8, 9, 10].sort(
      (x, y) => x - y
    );
    // The process dies dealing the second hand: one hand is out, the deck is short. Which
    // robot got it is random — the deal shuffles the player order too.
    const realDeal = CardLogic.dealCardsAsync.bind(CardLogic);
    let deals = 0;
    const deal = vi.spyOn(CardLogic, 'dealCardsAsync').mockImplementation(async (g, p) => {
      if (++deals === 2) throw new Error('simulated crash: second hand');
      return realDeal(g, p);
    });
    const crashed = GameState.nextGamePhaseAsync(game._id).catch((err) => err);
    await vi.runAllTimersAsync();
    expect(await crashed).toEqual(new Error('simulated crash: second hand'));
    deal.mockRestore();
    expect((await Games.findOneAsync(game._id)).gamePhase).toBe(GameState.PHASE.DEAL);
    const handsAtCrash = (await Cards.find({ gameId: game._id }).fetchAsync()).map(
      (h) => h.handCards.length
    );
    // Every old hand went back into the deck first; then exactly one new hand came out.
    expect([...handsAtCrash].sort()).toEqual([0, 9]);

    await drive(() => GameState.resumeAsync(game._id));

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.PROGRAM);
    expect(gameDoc.programRound).toBe(2); // fixture seeds 1; dealt once
    const hands = await Cards.find({ gameId: game._id }).fetchAsync();
    expect(hands.map((h) => h.handCards.length)).toEqual([9, 9]);
    expect(hands.map((h) => h.chosenCards)).toEqual([
      [-1, -1, -1, -1, -1],
      [-1, -1, -1, -1, -1],
    ]);
    const deck = await Decks.findOneAsync({ gameId: game._id });
    expect(deck.cards).toHaveLength(everyCard.length - 18);
    // Every card is somewhere, exactly once.
    expect([...deck.cards, ...hands.flatMap((h) => h.handCards)].sort((x, y) => x - y)).toEqual(
      everyCard
    );
    // No resume line for a deal: nobody saw the first one.
    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages).not.toContain(RESUME_CHAT);
  });

  it('rebuilds the deck from nothing when the very first deal is cut off', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.IDLE });
    const a = await insertPlayer(game._id, { userId: 'a' });
    const b = await insertPlayer(game._id, { userId: 'b' });
    await insertCards(a._id, game._id);
    await insertCards(b._id, game._id);
    // No deck yet: the deal creates it, shuffles, hands `a` nine cards, then dies.
    const realDeal = CardLogic.dealCardsAsync.bind(CardLogic);
    let deals = 0;
    const deal = vi.spyOn(CardLogic, 'dealCardsAsync').mockImplementation(async (g, p) => {
      if (++deals === 2) throw new Error('simulated crash: second hand');
      return realDeal(g, p);
    });
    const crashed = GameState.nextGamePhaseAsync(game._id).catch((err) => err);
    await vi.runAllTimersAsync();
    expect(await crashed).toBeInstanceOf(Error);
    deal.mockRestore();
    expect((await Decks.findOneAsync({ gameId: game._id })).cards).toHaveLength(84 - 9);

    await drive(() => GameState.resumeAsync(game._id));

    // Restoring to "no deck" removed the half-dealt one; the replayed deal built a full
    // 8-player deck and dealt both hands from it. Nothing went missing.
    expect((await Decks.findOneAsync({ gameId: game._id })).cards).toHaveLength(84 - 18);
    expect((await Games.findOneAsync(game._id)).gamePhase).toBe(GameState.PHASE.PROGRAM);
  });

  it('skips a player who left after the snapshot instead of re-inserting them', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
    const stays = await insertPlayer(game._id, { userId: 'stays', damage: 0 });
    const leaves = await insertPlayer(game._id, { userId: 'leaves' });
    await insertCards(stays._id, game._id, { userId: 'stays' });
    await insertCards(leaves._id, game._id, { userId: 'leaves' });
    vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();
    await drive(() => GameState.nextGamePhaseAsync(game._id)); // PLAY, snapshot taken
    await Players.removeAsync(leaves._id);
    await Cards.removeAsync({ playerId: leaves._id });
    await Players.updateAsync(stays._id, { $set: { damage: 4 } }); // the crashed run's work

    await drive(() => GameState.resumeAsync(game._id));

    expect(await Players.find({ gameId: game._id }).countAsync()).toBe(1);
    expect(await Cards.find({ gameId: game._id }).countAsync()).toBe(1);
    expect((await Players.findOneAsync(stays._id)).damage).toBe(0); // restored
  });

  it('resets the play-start fields and announces the replay once', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
    const player = await insertPlayer(game._id);
    await insertCards(player._id, game._id);
    vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();
    await drive(() => GameState.nextGamePhaseAsync(game._id));
    await Games.updateAsync(game._id, {
      $set: {
        playPhase: GameState.PLAY_PHASE.MOVE_BOTS,
        playPhaseCount: 4,
        cardsToPlay: [{ cardId: 1, playerId: player._id }],
        announceCard: { cardId: 1 },
        waitingForRespawn: [player._id],
      },
    });
    const { step } = await Games.findOneAsync(game._id);

    await drive(() => GameState.resumeAsync(game._id));

    expect(await Games.findOneAsync(game._id)).toMatchObject({
      gamePhase: GameState.PHASE.PLAY,
      playPhase: GameState.PLAY_PHASE.IDLE,
      playPhaseCount: 1,
      cardsToPlay: [],
      announceCard: null,
      waitingForRespawn: [],
      step: step + 2, // the touch, then the play-start claim
    });
    expect(GameState.nextPlayPhaseAsync).toHaveBeenLastCalledWith(game._id);
    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages.filter((m) => m === RESUME_CHAT)).toHaveLength(1);
  });

  it('two sweepers on the same game: one touch wins, one replay runs', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
    const player = await insertPlayer(game._id);
    await insertCards(player._id, game._id);
    vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();
    await drive(() => GameState.nextGamePhaseAsync(game._id));
    const { step } = await Games.findOneAsync(game._id);

    await drive(() =>
      Promise.all([GameState.resumeAsync(game._id), GameState.resumeAsync(game._id)])
    );

    expect((await Games.findOneAsync(game._id)).step).toBe(step + 2);
    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages.filter((m) => m === RESUME_CHAT)).toHaveLength(1);
  });

  it('refuses to restore from a snapshot for a different segment, and says so', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const game = await insertGame({
      gamePhase: GameState.PHASE.PLAY,
      segmentSnapshot: { segment: GameState.PHASE.DEAL, players: [], cards: [], deck: null },
    });
    const dispatch = vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();

    await drive(() => GameState.resumeAsync(game._id));

    expect(dispatch).not.toHaveBeenCalled();
    expect((await Games.findOneAsync(game._id)).step).toBe(0); // not even touched
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0]).toContain(game._id);
  });

  describe('outside the segments', () => {
    function spyDispatchers() {
      return {
        game: vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue(),
        play: vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue(),
        respawn: vi.spyOn(GameState, 'nextRespawnPhaseAsync').mockResolvedValue(),
      };
    }

    it('RESPAWN with no robot picked yet picks one', async () => {
      const game = await insertGame({ gamePhase: GameState.PHASE.RESPAWN, respawnPlayerId: null });
      const d = spyDispatchers();

      await drive(() => GameState.resumeAsync(game._id));

      expect(d.game).toHaveBeenCalledWith(game._id);
      expect(d.respawn).not.toHaveBeenCalled();
      expect((await Games.findOneAsync(game._id)).step).toBe(1);
    });

    it('RESPAWN with a robot picked but no options yet computes them', async () => {
      const game = await insertGame({
        gamePhase: GameState.PHASE.RESPAWN,
        respawnPlayerId: 'p1',
        selectOptions: null,
      });
      const d = spyDispatchers();

      await drive(() => GameState.resumeAsync(game._id));

      expect(d.respawn).toHaveBeenCalledWith(game._id);
      expect(d.game).not.toHaveBeenCalled();
    });

    it('RESPAWN with options on the table is a human’s move: untouched', async () => {
      const game = await insertGame({
        gamePhase: GameState.PHASE.RESPAWN,
        respawnPlayerId: 'p1',
        selectOptions: [{ x: 1, y: 1 }],
      });
      const d = spyDispatchers();

      await drive(() => GameState.resumeAsync(game._id));

      expect(d.game).not.toHaveBeenCalled();
      expect(d.respawn).not.toHaveBeenCalled();
      expect((await Games.findOneAsync(game._id)).step).toBe(0);
    });

    it('PROGRAM with every living player submitted is kicked into the turn', async () => {
      // `timer: 0` is what a timeout leaves when it finds nobody left to submit — the
      // shape of a last submit whose claim lost to a concurrent one.
      const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM, timer: 0 });
      await insertPlayer(game._id, { submitted: true });
      await insertPlayer(game._id, { submitted: false, lives: 0 }); // dead: does not count
      const d = spyDispatchers();

      await drive(() => GameState.resumeAsync(game._id));

      expect(d.game).toHaveBeenCalledWith(game._id);
      // The kick writes what the lost claim would have: a stale 0 would follow the game
      // into its next program phase, where every client auto-submits on sight of it.
      expect(await Games.findOneAsync(game._id)).toMatchObject({ timer: -1, timerStartedAt: null });
    });

    it('PROGRAM with someone still programming is untouched, however long it takes', async () => {
      const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
      await insertPlayer(game._id, { submitted: true });
      await insertPlayer(game._id, { submitted: false });
      const d = spyDispatchers();

      await drive(() => GameState.resumeAsync(game._id));

      expect(d.game).not.toHaveBeenCalled();
      expect((await Games.findOneAsync(game._id)).step).toBe(0);
    });

    it.each([GameState.PHASE.IDLE, GameState.PHASE.ENDED])(
      '%s: nothing to resume',
      async (gamePhase) => {
        const game = await insertGame({ gamePhase });
        const d = spyDispatchers();

        await drive(() => GameState.resumeAsync(game._id));

        expect(d.game).not.toHaveBeenCalled();
        expect(d.play).not.toHaveBeenCalled();
        expect((await Games.findOneAsync(game._id)).step).toBe(0);
      }
    );

    it('a game that no longer exists is not an error', async () => {
      await expect(GameState.resumeAsync('gone')).resolves.toBeUndefined();
    });
  });
});

describe('respawn phase: picking the next robot', () => {
  // Off-board parking spot for a dead robot on the 6x6 stub board.
  const PARKED = { x: 5, y: 6 };

  async function pickNext(gameId) {
    const p = GameState.nextGamePhaseAsync(gameId);
    await vi.runAllTimersAsync();
    await p;
    return Games.findOneAsync(gameId);
  }

  it('moves the robot to a free start tile and asks for a direction', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.RESPAWN });
    const dead = await insertPlayer(game._id, {
      needsRespawn: true,
      lives: 2,
      start: { x: 2, y: 2 },
      position: PARKED,
    });
    await Games.updateAsync(game._id, { $set: { waitingForRespawn: [dead._id] } });

    const gameDoc = await pickNext(game._id);

    expect(gameDoc.respawnPhase).toBe(GameState.RESPAWN_PHASE.CHOOSE_DIRECTION);
    expect(gameDoc.respawnPlayerId).toBe(dead._id);
    expect(gameDoc.selectOptions).toHaveLength(4);
    expect((await Players.findOneAsync(dead._id)).position).toEqual({ x: 2, y: 2 });
  });

  it('asks for a position instead when another robot holds the start tile', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.RESPAWN });
    const dead = await insertPlayer(game._id, {
      needsRespawn: true,
      lives: 2,
      start: { x: 2, y: 2 },
      position: PARKED,
    });
    await insertPlayer(game._id, { position: { x: 2, y: 2 } }); // the squatter
    await Games.updateAsync(game._id, { $set: { waitingForRespawn: [dead._id] } });

    const gameDoc = await pickNext(game._id);

    expect(gameDoc.respawnPhase).toBe(GameState.RESPAWN_PHASE.CHOOSE_POSITION);
    expect(gameDoc.selectOptions.length).toBeGreaterThan(0);
    expect((await Players.findOneAsync(dead._id)).position).toEqual(PARKED); // not moved
  });

  // A restart replays this step. The game document goes back to how it was before the
  // pick; the robot does not — the first run already put it on its own start tile.
  it('reaches the same decision when run again', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.RESPAWN });
    const dead = await insertPlayer(game._id, {
      needsRespawn: true,
      lives: 2,
      start: { x: 2, y: 2 },
      position: PARKED,
    });
    await Games.updateAsync(game._id, { $set: { waitingForRespawn: [dead._id] } });

    const first = await pickNext(game._id);
    expect(first.respawnPhase).toBe(GameState.RESPAWN_PHASE.CHOOSE_DIRECTION);

    await Games.updateAsync(game._id, {
      $set: {
        waitingForRespawn: [dead._id],
        respawnPlayerId: null,
        selectOptions: null,
        respawnUserId: null,
      },
    });
    const second = await pickNext(game._id);

    // Without the `_id` check the robot, now standing on its own start tile, would be
    // taken for a squatter and the second run would ask for a position instead.
    expect(second.respawnPhase).toBe(GameState.RESPAWN_PHASE.CHOOSE_DIRECTION);
    expect(second.selectOptions).toHaveLength(4);
    expect((await Players.findOneAsync(dead._id)).position).toEqual({ x: 2, y: 2 });
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
