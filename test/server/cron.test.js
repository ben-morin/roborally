// The three scheduled jobs in server/cron.js hold real cleanup logic that is otherwise
// unreachable without waiting out a schedule. The stub for `meteor/quave:synced-cron`
// records each job by name so these can invoke the body directly.
//
// Every offline check is a two-step: see the user offline, wait five seconds, look
// again. Fake timers drive that window, which also lets a test reconnect a user
// mid-wait and prove the recheck is load-bearing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import { resetFakeCollections, runStartup } from '../setup.js';
import { cronSchedule, cronStarted, registeredCronJobs, runCronJob } from '../stubs/synced-cron.js';
import { GameState } from '../../both/gamestate.js';
import { Chat } from '../../collections/chat.js';
import { Games } from '../../collections/games.js';
import { Highscores } from '../../collections/highscores.js';
import { Players } from '../../collections/players.js';

const UNSTARTED = 'Clean up unstarted games';
const ABANDONED = 'Clean up abandoned games';
const HIGHSCORES = 'Build highscore lists';

async function user(_id, { online = true, lastActivity = new Date() } = {}) {
  await Meteor.users.insertAsync({
    _id,
    emails: [{ address: `${_id}@example.com`, verified: true }],
    status: { online, lastActivity },
  });
  return _id;
}

// Start the job, let it reach its five-second recheck, optionally change the world,
// then let the recheck fire.
async function runWithRecheck(name, duringWait = async () => {}) {
  const running = runCronJob(name);
  await vi.advanceTimersByTimeAsync(1);
  await duringWait();
  await vi.advanceTimersByTimeAsync(10_000);
  return running;
}

beforeEach(() => resetFakeCollections());
afterEach(() => vi.useRealTimers());

describe('registration', () => {
  it('registers all three jobs on the documented schedules', () => {
    expect(registeredCronJobs()).toEqual([HIGHSCORES, UNSTARTED, ABANDONED]);
    expect(cronSchedule(HIGHSCORES)).toBe('every 1 hour');
    expect(cronSchedule(UNSTARTED)).toBe('every 5 minutes');
    expect(cronSchedule(ABANDONED)).toBe('every 1 minute');
  });

  it('starts the scheduler on startup', async () => {
    await runStartup();
    expect(cronStarted()).toBe(true);
  });
});

describe(HIGHSCORES, () => {
  it('rebuilds the lists', async () => {
    await Games.insertAsync({ winner: 'ann' });

    await runCronJob(HIGHSCORES);

    expect(await Highscores.findOneAsync({ type: 'mostWon' })).toMatchObject({ name: 'ann' });
  });
});

describe(UNSTARTED, () => {
  beforeEach(() => vi.useFakeTimers());

  it('removes an unstarted game whose owner is still offline after the recheck', async () => {
    const owner = await user('owner', { online: false });
    const gameId = await Games.insertAsync({ userId: owner, started: false });

    await runWithRecheck(UNSTARTED);

    expect(await Games.findOneAsync(gameId)).toBeUndefined();
  });

  it('keeps the game while the owner is online', async () => {
    const owner = await user('owner', { online: true });
    const gameId = await Games.insertAsync({ userId: owner, started: false });

    await runWithRecheck(UNSTARTED);

    expect(await Games.findOneAsync(gameId)).toBeDefined();
  });

  it('keeps the game when the owner reconnects during the recheck window', async () => {
    const owner = await user('owner', { online: false });
    const gameId = await Games.insertAsync({ userId: owner, started: false });

    await runWithRecheck(UNSTARTED, () =>
      Meteor.users.updateAsync(owner, { $set: { 'status.online': true } })
    );

    expect(await Games.findOneAsync(gameId)).toBeDefined();
  });

  it('never touches a started game', async () => {
    const owner = await user('owner', { online: false });
    const gameId = await Games.insertAsync({ userId: owner, started: true });

    await runWithRecheck(UNSTARTED);

    expect(await Games.findOneAsync(gameId)).toBeDefined();
  });

  it('leaves a game whose owner no longer exists', async () => {
    const gameId = await Games.insertAsync({ userId: 'deleted', started: false });

    await runWithRecheck(UNSTARTED);

    expect(await Games.findOneAsync(gameId)).toBeDefined();
  });
});

describe(ABANDONED, () => {
  beforeEach(() => vi.useFakeTimers());

  it("ends a game with winner 'Nobody' when every player has gone", async () => {
    await user('a', { online: false });
    const gameId = await Games.insertAsync({ started: true, min_player: 2 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });

    await runWithRecheck(ABANDONED);

    const game = await Games.findOneAsync(gameId);
    expect(game.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(game.winner).toBe('Nobody');
    expect(game.stopped).toBeTypeOf('number');
  });

  it('awards the win to the last player still connected', async () => {
    await user('a', { online: true });
    await user('b', { online: false });
    const gameId = await Games.insertAsync({ started: true, min_player: 2 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });
    await Players.insertAsync({ gameId, userId: 'b', name: 'bob' });

    await runWithRecheck(ABANDONED);

    const game = await Games.findOneAsync(gameId);
    expect(game.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(game.winner).toBe('ann');
    // The last-man-standing branch rebuilds the highscores; the 'Nobody' one does not.
    expect(await Highscores.findOneAsync({ type: 'mostWon' })).toMatchObject({ name: 'ann' });
  });

  it('lets a solo game continue when the board seats one player', async () => {
    await user('a', { online: true });
    const gameId = await Games.insertAsync({ started: true, min_player: 1 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });

    await runWithRecheck(ABANDONED);

    expect((await Games.findOneAsync(gameId)).winner).toBeUndefined();
  });

  it('ignores a game that already has a winner', async () => {
    await user('a', { online: false });
    const gameId = await Games.insertAsync({ started: true, min_player: 2, winner: 'ann' });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });

    await runWithRecheck(ABANDONED);

    expect((await Games.findOneAsync(gameId)).gamePhase).toBeUndefined();
  });

  // Characterization: the announcement says the player left, but the job only posts the
  // chat line — the Players document stays. They are counted as offline again on every
  // subsequent run, so the message repeats once a minute until the game ends.
  it('announces a disconnected player without removing them', async () => {
    await user('a', { online: true });
    await user('b', { online: false });
    const gameId = await Games.insertAsync({ started: true, min_player: 1 });
    await Players.insertAsync({ gameId, userId: 'b', name: 'bob' });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });

    await runWithRecheck(ABANDONED);

    const chat = await Chat.find({ gameId }).fetchAsync();
    expect(chat.map((c) => c.message)).toEqual(['bob disconnected and left the game']);
    expect(await Players.find({ gameId }).countAsync()).toBe(2);
  });

  it('marks users inactive for more than thirty minutes as offline', async () => {
    const stale = new Date(Date.now() - 45 * 60 * 1000);
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    await user('stale', { online: true, lastActivity: stale });
    await user('recent', { online: true, lastActivity: recent });

    await runCronJob(ABANDONED); // no games, so no recheck delay to advance

    expect((await Meteor.users.findOneAsync('stale')).status.online).toBe(false);
    expect((await Meteor.users.findOneAsync('recent')).status.online).toBe(true);
  });
});
