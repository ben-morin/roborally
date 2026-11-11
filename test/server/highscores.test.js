// buildHighscores() counts both lists from the in-memory collections, so the counting, the
// order of a tie and the cut to ten are what is under test.
//
// Both lists group on the account's userId, never on a name: a username can change, and
// accounts older than the unique-username rule can share one. The 'accounts that share a
// display name' cases below are the guard on that.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import { loginAs, resetFakeCollections, runStartup } from '../setup.js';
import { runCronJob } from '../stubs/synced-cron.js';
import { buildHighscores } from '../../server/highscores.ts';
import { GameState } from '../../both/gamestate.ts';
import { Games } from '../../collections/games.ts';
import { Highscores } from '../../collections/highscores.ts';
import { Players } from '../../collections/players.ts';

const rowsOf = async (type) =>
  (await Highscores.find({ type }).fetchAsync()).sort((a, b) => a.rank - b.rank);
const listOf = async (type) =>
  (await rowsOf(type)).map(({ name, value, rank }) => ({ name, value, rank }));

// The ranking counts only accounts that exist, so the helpers below seat one under the
// name given, unless the test already did.
async function account(userId, name) {
  if (!(await Meteor.users.findOneAsync(userId))) {
    await Meteor.users.insertAsync({ _id: userId, profile: { name } });
  }
}

// A finished game carries both fields: `winner` is the display name the board and the
// game list render, `winnerUserId` is the aggregation key. This keeps the pair consistent
// the way every end-of-game path in the app does.
const wonGame = async (name, userId = `id_${name}`, extra = {}) => {
  await account(userId, name);
  return Games.insertAsync({ winner: name, winnerUserId: userId, started: true, ...extra });
};

// A player of a game, as joinGame writes one: the account id it belongs to, plus the
// display name that account resolved to at the time.
const playedGame = async (gameId, name, userId = `id_${name}`) => {
  await account(userId, name);
  return Players.insertAsync({ gameId, userId, name });
};

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
      boardName: 'default',
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
      boardName: 'default',
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
      boardName: 'default',
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
      await account(name, name);
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
      boardName: 'default',
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'quitter' });
    await account('ann', 'ann');
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

// A tie goes to whoever got there first: the account whose latest win, or latest game, is
// older, since that is when it reached the count. Reached together, in one game: whoever
// reached the count before it first, and so on down. Equal all the way, or no times at all,
// fall back to the name, so a tie never trades places between rebuilds.
describe('ties', () => {
  it('ranks first the player who reached a win count first', async () => {
    await wonGame('bob', undefined, { stopped: 100 });
    await wonGame('ann', undefined, { stopped: 200 });
    await wonGame('ann', undefined, { stopped: 250 });
    await wonGame('bob', undefined, { stopped: 300 });

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([
      { name: 'ann', value: 2, rank: 1 },
      { name: 'bob', value: 2, rank: 2 },
    ]);
  });

  it('ranks first the player whose latest game was created first', async () => {
    await Games.insertAsync({ _id: 'early', submitted: 100 });
    await Games.insertAsync({ _id: 'middle', submitted: 200 });
    await Games.insertAsync({ _id: 'late', submitted: 300 });
    await playedGame('early', 'bob');
    await playedGame('late', 'bob');
    await playedGame('early', 'ann');
    await playedGame('middle', 'ann');

    await buildHighscores();

    expect(await listOf('mostPlayed')).toEqual([
      { name: 'ann', value: 2, rank: 1 },
      { name: 'bob', value: 2, rank: 2 },
    ]);
  });

  it('goes back a count when both reached it in the same game', async () => {
    await Games.insertAsync({ _id: 'first', submitted: 100 });
    await Games.insertAsync({ _id: 'second', submitted: 200 });
    await Games.insertAsync({ _id: 'together', submitted: 300 });
    // Both reach 2 games together; ann reached 1 game first.
    await playedGame('second', 'ann');
    await playedGame('first', 'zed');
    await playedGame('together', 'ann');
    await playedGame('together', 'zed');

    await buildHighscores();

    expect((await listOf('mostPlayed')).map(({ name }) => name)).toEqual(['zed', 'ann']);
  });

  it('still puts the higher count first, however late it came', async () => {
    await wonGame('ann', undefined, { stopped: 100 });
    await wonGame('bob', undefined, { stopped: 800 });
    await wonGame('bob', undefined, { stopped: 900 });

    await buildHighscores();

    expect((await listOf('mostWon')).map(({ name }) => name)).toEqual(['bob', 'ann']);
  });

  it('falls back to the name when the times match or are missing', async () => {
    await wonGame('cy', undefined, { stopped: 500 });
    await wonGame('bob', undefined, { stopped: 500 });
    await wonGame('dee');
    await wonGame('ann');

    await buildHighscores();

    expect((await listOf('mostWon')).map(({ name }) => name)).toEqual(['ann', 'dee', 'bob', 'cy']);
  });
});

// The hover text on a count: when the account reached it.
describe('the date a count was reached', () => {
  it("is a player's latest win, for most wins", async () => {
    await wonGame('ann', undefined, { stopped: 300 });
    await wonGame('ann', undefined, { stopped: 100 });

    await buildHighscores();

    expect((await rowsOf('mostWon'))[0].reachedAt).toBe(300);
  });

  it("is the creation of a player's latest game, for most games", async () => {
    await Games.insertAsync({ _id: 'early', submitted: 100 });
    await Games.insertAsync({ _id: 'late', submitted: 300 });
    await playedGame('late', 'ann');
    await playedGame('early', 'ann');

    await buildHighscores();

    expect((await rowsOf('mostPlayed'))[0].reachedAt).toBe(300);
  });

  it('is left out when no game kept a time', async () => {
    await wonGame('ann');

    await buildHighscores();

    expect((await rowsOf('mostWon'))[0]).not.toHaveProperty('reachedAt');
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

// The reason both pipelines group on userId. Before usernames were unique, sign-up named
// an account after the local part of its address, so user@domain1.com and user@domain2.com
// could be two accounts with one name; grouping on the name added their wins together and
// showed a single row with a total neither of them had. Two rows that look alike is the
// accepted cost.
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
});

// A row follows its account: a rename shows up, and a deleted account leaves while its
// games keep the name stamped on them.
describe('renamed and deleted accounts', () => {
  // Written straight to the collections: the helpers above would seat the account.
  const orphanWin = () =>
    Games.insertAsync({ winner: 'gone', winnerUserId: 'deleted', started: true });

  it('labels a row with the name the account has now', async () => {
    await account('u1', 'renamed');
    await wonGame('name at the time', 'u1');

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'renamed', value: 1, rank: 1 }]);
  });

  it('leaves out an account that no longer exists', async () => {
    await wonGame('ann');
    await orphanWin();
    await orphanWin();
    await Players.insertAsync({ gameId: 'g1', userId: 'deleted', name: 'gone' });

    await buildHighscores();

    expect(await listOf('mostWon')).toEqual([{ name: 'ann', value: 1, rank: 1 }]);
    expect(await listOf('mostPlayed')).toEqual([]);
  });

  it('fills all ten places from the accounts that remain, ranked from 1', async () => {
    await orphanWin();
    await orphanWin();
    for (let i = 0; i < 11; i++) {
      await wonGame(`player${i}`);
    }

    await buildHighscores();

    const list = await listOf('mostWon');
    expect(list.map(({ rank }) => rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(list.map(({ name }) => name)).not.toContain('gone');
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
