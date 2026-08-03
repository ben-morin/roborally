// buildHighscores() is the only aggregation in the app. These run it against the
// in-memory aggregate (see the $group/$sum support in test/setup.js) rather than mocking
// rawCollection, so the pipeline itself — match, group, sort, limit — is what is under
// test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { runCronJob } from '../stubs/synced-cron.js';
import { buildHighscores } from '../../server/highscores.js';
import { GameState } from '../../both/gamestate.js';
import { Games } from '../../collections/games.js';
import { Highscores } from '../../collections/highscores.js';
import { Players } from '../../collections/players.js';

const listOf = async (type) =>
  (await Highscores.find({ type }).fetchAsync())
    .sort((a, b) => a.rank - b.rank)
    .map(({ name, value, rank }) => ({ name, value, rank }));

beforeEach(() => resetFakeCollections());
afterEach(() => vi.useRealTimers());

describe('mostWon', () => {
  it('counts wins per player and ranks them, highest first', async () => {
    for (const winner of ['ann', 'ann', 'ann', 'bob', 'bob', 'cy']) {
      await Games.insertAsync({ winner, started: true });
    }

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([
      { name: 'ann', value: 3, rank: 1 },
      { name: 'bob', value: 2, rank: 2 },
      { name: 'cy', value: 1, rank: 3 },
    ]);
  });

  it("excludes games won by 'Nobody'", async () => {
    await Games.insertAsync({ winner: 'Nobody' });
    await Games.insertAsync({ winner: 'Nobody' });
    await Games.insertAsync({ winner: 'ann' });

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });

  it('keeps at most ten entries', async () => {
    for (let i = 0; i < 15; i++) {
      await Games.insertAsync({ winner: `player${i}` });
    }

    await buildHighscores();

    expect(await listOf('mostWon')).toHaveLength(10);
  });

  // Regression guard. `{$ne: 'Nobody'}` alone also matches games with no `winner` field —
  // every game still in progress — grouping them under a single `_id: null` bucket that
  // the ranking page rendered as a blank name. With more games in progress than any
  // player has wins, it took rank 1. The `$exists: true` in the $match is what stops it.
  it('ignores games that are still in progress', async () => {
    await Games.insertAsync({ winner: 'ann', started: true });
    for (let i = 0; i < 3; i++) {
      await Games.insertAsync({ name: `in progress ${i}`, started: true });
    }

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });
});

// The three ways a game can end with nobody winning. These drive the real end-of-game
// code paths rather than writing `winner` by hand, so the exclusion stays anchored to how
// games actually finish: if a path ever stops using the 'Nobody' sentinel that
// server/highscores.js filters on, these fail rather than silently crediting a win.
describe('games nobody won', () => {
  it('excludes a game where every robot died', async () => {
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PLAY,
      playPhase: GameState.PLAY_PHASE.CHECKPOINTS,
      playPhaseCount: 1,
      waitingForRespawn: [],
      cardsToPlay: [],
    });
    for (const name of ['ann', 'bob']) {
      await Players.insertAsync({
        gameId,
        userId: name,
        name,
        lives: 0,
        position: { x: 0, y: 0 },
        visited_checkpoints: 0,
        needsRespawn: false,
      });
    }

    vi.useFakeTimers();
    const running = GameState.nextPlayPhaseAsync(gameId);
    await vi.advanceTimersByTimeAsync(1000);
    await running;

    expect((await Games.findOneAsync(gameId)).winner).toBe('Nobody');
    await buildHighscores();
    expect(await listOf('mostWon')).toEqual([]);
  });

  it('excludes a game whose last player left', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ann' });

    await Meteor.callAsync('leaveGame', gameId);

    expect((await Games.findOneAsync(gameId)).winner).toBe('Nobody');
    await buildHighscores();
    expect(await listOf('mostWon')).toEqual([]);
  });

  it('excludes a game everyone disconnected from', async () => {
    await Meteor.users.insertAsync({ _id: 'ann', status: { online: false } });
    const gameId = await Games.insertAsync({ started: true, min_player: 2 });
    await Players.insertAsync({ gameId, userId: 'ann', name: 'ann' });

    vi.useFakeTimers();
    const running = runCronJob('Clean up abandoned games');
    await vi.advanceTimersByTimeAsync(10_000);
    await running;

    expect((await Games.findOneAsync(gameId)).winner).toBe('Nobody');
    await buildHighscores();
    expect(await listOf('mostWon')).toEqual([]);
  });

  it('still counts a real win alongside games nobody won', async () => {
    await Games.insertAsync({ winner: 'ann', started: true });
    await Games.insertAsync({ winner: 'Nobody', started: true });
    await Games.insertAsync({ name: 'in progress', started: true });

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });
});

describe('mostPlayed', () => {
  it('counts games played per player name across every game', async () => {
    await Players.insertAsync({ gameId: 'g1', name: 'ann' });
    await Players.insertAsync({ gameId: 'g2', name: 'ann' });
    await Players.insertAsync({ gameId: 'g1', name: 'bob' });

    await buildHighscores();

    expect(await listOf('mostPlayed')).toEqual([
      { name: 'ann', value: 2, rank: 1 },
      { name: 'bob', value: 1, rank: 2 },
    ]);
  });

  it('keeps at most ten entries', async () => {
    for (let i = 0; i < 12; i++) {
      await Players.insertAsync({ gameId: `g${i}`, name: `player${i}` });
    }

    await buildHighscores();

    expect(await listOf('mostPlayed')).toHaveLength(10);
  });
});

describe('rebuilding', () => {
  it('replaces the previous lists rather than appending to them', async () => {
    await Games.insertAsync({ winner: 'ann' });
    await buildHighscores();
    await buildHighscores();
    await buildHighscores();

    expect(await Highscores.find().countAsync()).toBe(1);
  });

  it('leaves both lists empty when there is nothing to rank', async () => {
    await Highscores.insertAsync({ type: 'mostWon', name: 'stale', value: 1, rank: 1 });

    await buildHighscores();

    expect(await Highscores.find().countAsync()).toBe(0);
  });
});
