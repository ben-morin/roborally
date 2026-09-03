// buildHighscores() is the only aggregation in the app. These run it against the
// in-memory aggregate (see the $group/$sum/$last support in test/setup.js) rather than
// mocking rawCollection, so the pipeline itself — match, group, sort, limit — is what is
// under test.
//
// Both lists group on the account's userId, never on a display name: display names are
// the local part of an email address and two domains produce the same one. The
// 'accounts that share a display name' cases below are the guard on that.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import { loginAs, resetFakeCollections, runStartup } from '../setup.js';
import { runCronJob } from '../stubs/synced-cron.js';
import { buildHighscores } from '../../server/highscores.ts';
import { GameState } from '../../both/gamestate.ts';
import { Games } from '../../collections/games.ts';
import { Highscores } from '../../collections/highscores.ts';
import { Players } from '../../collections/players.ts';

const listOf = async (type) =>
  (await Highscores.find({ type }).fetchAsync())
    .sort((a, b) => a.rank - b.rank)
    .map(({ name, value, rank }) => ({ name, value, rank }));

// A finished game carries both fields: `winner` is the display name the board and the
// game list render, `winnerUserId` is the aggregation key. This keeps the pair consistent
// the way every end-of-game path in the app does. With no account behind the id,
// addToHighscores falls back to the stamped name — so these assertions still read as
// names without every test having to seat a user document.
const wonGame = (name, userId = `id_${name}`, extra = {}) =>
  Games.insertAsync({ winner: name, winnerUserId: userId, started: true, ...extra });

// A player of a game, as joinGame writes one: the account id it belongs to, plus the
// display name that account resolved to at the time.
const playedGame = (gameId, name, userId = `id_${name}`) =>
  Players.insertAsync({ gameId, userId, name });

beforeEach(() => resetFakeCollections());
afterEach(() => vi.useRealTimers());

describe('mostWon', () => {
  it('counts wins per player and ranks them, highest first', async () => {
    for (const winner of ['ann', 'ann', 'ann', 'bob', 'bob', 'cy']) {
      await wonGame(winner);
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
    await wonGame('ann');

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });

  it('keeps at most ten entries', async () => {
    for (let i = 0; i < 15; i++) {
      await wonGame(`player${i}`);
    }

    await buildHighscores();

    expect(await listOf('mostWon')).toHaveLength(10);
  });

  // Regression guard, kept from when the $match was `{winner: {$exists: true, $ne:
  // 'Nobody'}}`: `$ne` alone also matched every game still in progress, grouping them
  // under a single `_id: null` bucket the ranking page rendered as a blank name, and with
  // more games in progress than anyone had wins it took rank 1. Matching on
  // `winnerUserId` makes that structural — an unfinished game has no such field — but the
  // outcome is worth pinning either way.
  it('ignores games that are still in progress', async () => {
    await wonGame('ann');
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
// server/highscores.ts filters on, these fail rather than silently crediting a win.
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

    await Meteor.callAsync('leaveGame', { gameId });

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
    await wonGame('ann');
    await Games.insertAsync({ winner: 'Nobody', started: true });
    await Games.insertAsync({ name: 'in progress', started: true });

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });
});

// The counterpart to the block above: the three ways a game ends with a surviving player
// who never reached the last checkpoint. All three count as wins — `winner` records who
// was left standing, not how — and each path rebuilds the highscores itself as it ends
// the game, so these assert on the ranking without calling buildHighscores() again.
describe('wins by default', () => {
  it('counts the last robot standing after the others were destroyed', async () => {
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PLAY,
      playPhase: GameState.PLAY_PHASE.CHECKPOINTS,
      playPhaseCount: 1,
      waitingForRespawn: [],
      cardsToPlay: [],
    });
    for (const [name, lives] of [
      ['ann', 3],
      ['bob', 0],
    ]) {
      await Players.insertAsync({
        gameId,
        userId: name,
        name,
        lives,
        position: { x: 0, y: 0 },
        visited_checkpoints: 0,
        needsRespawn: false,
      });
    }

    vi.useFakeTimers();
    const running = GameState.nextPlayPhaseAsync(gameId);
    await vi.advanceTimersByTimeAsync(1000);
    await running;

    expect((await Games.findOneAsync(gameId)).winner).toBe('ann');
    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });

  it('counts a win handed over when the only opponent quits', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'quitter' });
    await Players.insertAsync({ gameId, userId: 'ann', name: 'ann' });

    await Meteor.callAsync('leaveGame', { gameId });

    expect((await Games.findOneAsync(gameId)).winner).toBe('ann');
    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });

  it('counts a win left behind when the only opponent disconnects', async () => {
    await Meteor.users.insertAsync({ _id: 'ann', status: { online: true } });
    await Meteor.users.insertAsync({ _id: 'bob', status: { online: false } });
    const gameId = await Games.insertAsync({ started: true, min_player: 2 });
    await Players.insertAsync({ gameId, userId: 'ann', name: 'ann' });
    await Players.insertAsync({ gameId, userId: 'bob', name: 'bob' });

    vi.useFakeTimers();
    const running = runCronJob('Clean up abandoned games');
    await vi.advanceTimersByTimeAsync(10_000);
    await running;

    expect((await Games.findOneAsync(gameId)).winner).toBe('ann');
    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });

  it('ranks a default win level with a checkpoint win', async () => {
    await wonGame('ann'); // however it was earned
    await wonGame('bob');
    await wonGame('bob');

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([
      { name: 'bob', value: 2, rank: 1 },
      { name: 'ann', value: 1, rank: 2 },
    ]);
  });
});

describe('mostPlayed', () => {
  it('counts games played per account across every game', async () => {
    await playedGame('g1', 'ann');
    await playedGame('g2', 'ann');
    await playedGame('g1', 'bob');

    await buildHighscores();

    expect(await listOf('mostPlayed')).toEqual([
      { name: 'ann', value: 2, rank: 1 },
      { name: 'bob', value: 1, rank: 2 },
    ]);
  });

  it('keeps at most ten entries', async () => {
    for (let i = 0; i < 12; i++) {
      await playedGame(`g${i}`, `player${i}`);
    }

    await buildHighscores();

    expect(await listOf('mostPlayed')).toHaveLength(10);
  });
});

// The reason both pipelines group on userId. `profile.name` is the local part of an
// email address, so user@domain1.com and user@domain2.com are two accounts with one
// name; grouping on the name added their wins together and showed a single row with a
// total neither of them had. Two rows that look alike is the accepted cost.
describe('accounts that share a display name', () => {
  const seat = (_id, name) => Meteor.users.insertAsync({ _id, profile: { name } });

  it('counts wins per account, not per name', async () => {
    await seat('u1', 'user');
    await seat('u2', 'user');
    await wonGame('user', 'u1');
    await wonGame('user', 'u2');
    await wonGame('user', 'u2');

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([
      { name: 'user', value: 2, rank: 1 },
      { name: 'user', value: 1, rank: 2 },
    ]);
  });

  it('counts games played per account, not per name', async () => {
    await seat('u1', 'user');
    await seat('u2', 'user');
    await playedGame('g1', 'user', 'u1');
    await playedGame('g2', 'user', 'u2');
    await playedGame('g3', 'user', 'u2');

    await buildHighscores();

    expect(await listOf('mostPlayed')).toEqual([
      { name: 'user', value: 2, rank: 1 },
      { name: 'user', value: 1, rank: 2 },
    ]);
  });

  // Resolved from the account at build time, not read off the game document — so the day
  // players can rename themselves, an old game does not keep showing the old name.
  it('labels a row with the name the account has now', async () => {
    await seat('u1', 'renamed');
    await wonGame('name at the time', 'u1');

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'renamed', value: 1, rank: 1 }]);
  });

  // Nothing in the app deletes an account, so this is the defensive branch: the name
  // stamped on the game is a better label than a placeholder.
  it('falls back to the stamped name when the account is gone', async () => {
    await wonGame('vanished', 'deleted-account');

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'vanished', value: 1, rank: 1 }]);
  });
});

// Games that finished before winnerUserId was recorded would drop out of mostWon
// entirely, so startup resolves them from each game's own players.
describe('winnerUserId backfill', () => {
  it('resolves a historical winner from that game’s players', async () => {
    const gameId = await Games.insertAsync({ winner: 'ann', started: true });
    await playedGame(gameId, 'ann', 'u1');
    await playedGame(gameId, 'bob', 'u2');

    await runStartup();

    expect((await Games.findOneAsync(gameId)).winnerUserId).toBe('u1');
    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
  });

  it('leaves a game alone when two of its players shared the winning name', async () => {
    const gameId = await Games.insertAsync({ winner: 'user', started: true });
    await playedGame(gameId, 'user', 'u1');
    await playedGame(gameId, 'user', 'u2');

    await runStartup();

    // Guessing which of them won would credit the wrong account; a missing row is better.
    expect((await Games.findOneAsync(gameId)).winnerUserId).toBeUndefined();
  });

  it('leaves a game alone when the winner’s player document is gone', async () => {
    // leaveGame deletes the Players document, so a winner who later left is unresolvable.
    const gameId = await Games.insertAsync({ winner: 'departed', started: true });

    await runStartup();

    expect((await Games.findOneAsync(gameId)).winnerUserId).toBeUndefined();
  });

  it('does not touch a game that nobody won', async () => {
    const gameId = await Games.insertAsync({ winner: 'Nobody', started: true });
    await playedGame(gameId, 'Nobody', 'u1');

    await runStartup();

    expect((await Games.findOneAsync(gameId)).winnerUserId).toBeUndefined();
  });

  it('does not overwrite a userId that is already recorded', async () => {
    const gameId = await wonGame('ann', 'the-real-winner');
    await playedGame(gameId, 'ann', 'someone-else');

    await runStartup();

    expect((await Games.findOneAsync(gameId)).winnerUserId).toBe('the-real-winner');
  });
});

describe('rebuilding', () => {
  it('replaces the previous lists rather than appending to them', async () => {
    await wonGame('ann');
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
