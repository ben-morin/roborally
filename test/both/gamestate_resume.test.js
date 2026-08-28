// The property behind resumable turns: kill the server at ANY write inside a turn — before
// the write landed or just after — and the `Recover stalled turns` sweep brings the game to
// the same end state an uninterrupted turn reaches. Every write index is tried, on both
// sides, for two turns: one that runs through play, repairs and the deal into the next
// program phase, and one where a robot dies and the turn ends waiting on its owner.
//
// Recovery goes through the sweep (server/resume.js), not GameState.resumeAsync directly,
// so the sweep's own decisions are under the property too: a crash before the PLAY write
// leaves a program phase where everyone has submitted, which only the sweep's PROGRAM
// path picks up, and a crash inside the respawn phase needs its phase logic.
//
// Budget: the whole file must stay well under the ~5 s the plan allows the suite to grow
// by. It exercises every write index at full resolution; if that ever stops fitting, thin
// the indices here and say so in this comment — never silently.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crashAtWrite, resetFakeCollections, SimulatedCrash, writeCount } from '../setup.js';
import { insertCards, insertDeck, insertGame, insertPlayer } from '../helpers/fixtures.js';
import { stubBoard } from '../helpers/board.js';
import { GameLogic } from '../../both/gamelogic.js';
import { GameState, setBuildHighscores } from '../../both/gamestate.js';
import { Tile } from '../../both/tile.js';
import { Cards } from '../../collections/cards.js';
import { Deck } from '../../collections/deck.js';
import { Games } from '../../collections/games.js';
import { Players } from '../../collections/players.js';
import { resumeStalledTurnsAsync, STALL_MS } from '../../server/resume.js';

// The one random call inside a segment. A replayed deal has to deal the same hands as the
// reference run or nothing after a crash inside the deal segment could be compared.
vi.mock('../../both/shuffle.js', () => ({ shuffle: (a) => a.slice() }));

const T0 = new Date('2026-08-27T12:00:00Z');
const COVERED = [-2, -2, -2, -2, -2];

// Card ids of the 8-player deck: 0–5 u-turn, 6–23 right, 24–41 left, 42–47 back,
// 48–65 step 1, 66–77 step 2, 78–83 step 3. Higher id plays first.

// Both robots have submitted and the last submit's `timer: -1` claim has stamped
// `lastStepAt` — that is the state the PROGRAM handler is entered from in production, and
// the stamp is what the sweep measures a stall from. Without it a crash before the chain's
// first write would leave a game the sweep can never see.
async function seedGame() {
  return insertGame({ gamePhase: GameState.PHASE.PROGRAM, lastStepAt: new Date() });
}

async function seedRobot(gameId, name, fields) {
  return insertPlayer(gameId, {
    name,
    userId: name,
    submitted: true,
    cards: COVERED,
    start: { ...fields.position },
    ...fields,
  });
}

// Two robots in one row, facing each other. Over five registers they step, push and shoot
// each other; nobody dies, no checkpoint is reached. Repairs hand over to the deal, so the
// run crosses both segments and ends in the next program phase with fresh hands out.
async function seedFullTurn() {
  stubBoard();
  const game = await seedGame();
  const a = await seedRobot(game._id, 'a', { position: { x: 1, y: 2 }, direction: GameLogic.RIGHT });
  const b = await seedRobot(game._id, 'b', { position: { x: 4, y: 2 }, direction: GameLogic.LEFT });
  // a: step, step, turn-left, u-turn, step · b: step, turn-right, step, turn-left, step
  await insertCards(a._id, game._id, { handCards: [60, 61, 62, 63], chosenCards: [48, 50, 24, 0, 52] });
  await insertCards(b._id, game._id, { handCards: [70, 71], chosenCards: [49, 7, 51, 25, 53] });
  await insertDeck(game._id, { cards: Array.from({ length: 20 }, (_, i) => i) });
  return game._id;
}

function expectFullTurnEnd(state) {
  expect(state.games[0]).toMatchObject({ gamePhase: GameState.PHASE.PROGRAM, programRound: 2 });
  expect(state.players.map((p) => p.submitted)).toEqual([false, false]);
  expect(state.cards.map((c) => c.handCards.length)).toEqual([8, 7]); // 9 minus damage
}

// One robot steps into a pit in register 1 and sits out the rest of the turn while the
// other keeps moving. Repairs hand over to the respawn phase: the dead robot is put back on
// its start square and the turn ends waiting for its owner to choose a direction.
async function seedDeathTurn() {
  const board = stubBoard();
  board.getTile(2, 1).type = Tile.VOID;
  const game = await seedGame();
  const a = await seedRobot(game._id, 'a', { position: { x: 1, y: 1 }, direction: GameLogic.RIGHT });
  const b = await seedRobot(game._id, 'b', { position: { x: 0, y: 4 }, direction: GameLogic.RIGHT });
  // a: step (into the pit), then cards it never gets to play · b: step, step, turn-right,
  // step, u-turn
  await insertCards(a._id, game._id, { handCards: [60, 61, 62, 63], chosenCards: [48, 6, 24, 1, 25] });
  await insertCards(b._id, game._id, { handCards: [70, 71], chosenCards: [49, 50, 7, 51, 0] });
  await insertDeck(game._id, { cards: Array.from({ length: 20 }, (_, i) => i) });
  return game._id;
}

function expectDeathTurnEnd(state) {
  expect(state.games[0]).toMatchObject({
    gamePhase: GameState.PHASE.RESPAWN,
    respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_DIRECTION,
    respawnUserId: 'a',
    waitingForRespawn: [],
  });
  expect(state.games[0].selectOptions).toHaveLength(4);
  expect(state.players[0]).toMatchObject({ lives: 2, needsRespawn: true, position: { x: 1, y: 1 } });
  expect(state.players[1]).toMatchObject({ lives: 3, position: { x: 2, y: 5 }, direction: GameLogic.UP });
}

const SCENARIOS = [
  ['a full turn: play, repairs, deal', seedFullTurn, expectFullTurnEnd],
  ['a turn with a death: play, repairs, respawn', seedDeathTurn, expectDeathTurnEnd],
];

// Everything a turn can change, minus the claim bookkeeping. Chat is left out: a replayed
// turn repeats its lines and the resume announces itself. FakeCollection ids are
// `${name}_${seq}` and reset with the collections, so two identical seeds compare equal.
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
    deck: plain(await Deck.find().fetchAsync()),
  };
}

async function drive(fn) {
  const p = fn();
  await vi.runAllTimersAsync();
  return p;
}

// A fresh world at the same fake clock, so the runs differ in nothing but the crash.
async function reseed(seed) {
  resetFakeCollections();
  vi.restoreAllMocks();
  vi.setSystemTime(T0);
  return seed();
}

// The undisturbed turn: its end state, and the range of write indices the turn spans —
// the seed's own inserts come first and are not crash points.
async function runReference(seed) {
  const gameId = await reseed(seed);
  const firstWrite = writeCount() + 1;
  await drive(() => GameState.nextGamePhaseAsync(gameId));
  return { gameId, state: await finalState(), firstWrite, lastWrite: writeCount() };
}

// Same seed, killed at write `index`, then left for the sweep to find once the stall
// threshold has passed. Resolves to the end state the sweep's replay reaches.
async function crashAndRecover(seed, index, when) {
  const label = `crash ${when} write #${index}`;
  const gameId = await reseed(seed);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  crashAtWrite(index, when);
  const outcome = await drive(() => GameState.nextGamePhaseAsync(gameId).catch((err) => err));
  crashAtWrite(null);
  expect(outcome, `${label}: the chain should have died there`).toBeInstanceOf(SimulatedCrash);

  vi.setSystemTime(Date.now() + STALL_MS + 1000);
  const replays = await resumeStalledTurnsAsync();
  await vi.runAllTimersAsync();
  await Promise.all(replays);
  expect(errors, `${label}: the replay failed`).not.toHaveBeenCalled();
  return finalState();
}

beforeEach(() => {
  vi.useFakeTimers();
  setBuildHighscores(async () => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetFakeCollections();
});

describe.each(SCENARIOS)('%s', (_name, seed, expectEnd) => {
  it('reaches the expected end state, and does so identically twice', async () => {
    const first = await runReference(seed);
    expectEnd(first.state);
    expect(first.lastWrite - first.firstWrite).toBeGreaterThan(50);
    const second = await runReference(seed);
    expect(second.state).toEqual(first.state);
    expect(second.lastWrite).toBe(first.lastWrite);
  });

  it.each(['before', 'after'])(
    'is recovered by the sweep to the reference state from a crash %s any write',
    async (when) => {
      const reference = await runReference(seed);
      for (let index = reference.firstWrite; index <= reference.lastWrite; index++) {
        const recovered = await crashAndRecover(seed, index, when);
        expect(recovered, `crash ${when} write #${index}`).toEqual(reference.state);
      }
    }
  );

  // Two drivers entering the turn together — a double-clicked start, a timer-0 submit
  // racing the auto-submit. One wins the first claim and drives the whole turn; the other
  // does nothing.
  it('two drivers entering the turn together end in the reference state', async () => {
    const reference = await runReference(seed);
    const gameId = await reseed(seed);

    await drive(() =>
      Promise.all([GameState.nextGamePhaseAsync(gameId), GameState.nextGamePhaseAsync(gameId)])
    );

    expect(await finalState()).toEqual(reference.state);
  });
});
