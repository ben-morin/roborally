// The scheduled jobs in server/cron.ts hold real cleanup and recovery logic that is
// otherwise unreachable without waiting out a schedule. The stub for
// `meteor/quave:synced-cron` records each job by name so these can invoke the body directly.
//
// Every offline check is a two-step: see the user offline, wait five seconds, look
// again. Fake timers drive that window, which also lets a test reconnect a user
// mid-wait and prove the recheck is load-bearing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import { resetFakeCollections, runStartup, setSettings } from '../setup.js';
import { cronSchedule, cronStarted, registeredCronJobs, runCronJob } from '../stubs/synced-cron.js';
import { insertCards, insertDeck, insertGame, insertPlayer } from '../helpers/fixtures.js';
import { stubBoard } from '../helpers/board.js';
import { GameLogic } from '../../both/gamelogic.ts';
import { GameState } from '../../both/gamestate.ts';
import { Chat } from '../../collections/chat.ts';
import { Games } from '../../collections/games.ts';
import { Highscores } from '../../collections/highscores.ts';
import { Players } from '../../collections/players.ts';
import { STALL_MS } from '../../server/resume.ts';

const UNSTARTED = 'Clean up unstarted games';
const ABANDONED = 'Clean up abandoned games';
const HIGHSCORES = 'Build highscore lists';
const STALLED = 'Recover stalled programming timers';
const RESUME = 'Recover stalled turns';

const RESUME_CHAT = 'Server restarted — replaying this turn from the start';
// What `Clean up abandoned games` sits out after boot when nothing overrides it — see
// server/cron.ts, where `Meteor.settings.BOOT_GRACE_SEC` can shorten it.
const BOOT_GRACE_MS = 5 * 60 * 1000;

// `name` is the display name the account resolves to, which in production always matches
// the `name` on that user's Players document — joinGame stamps both from getUsername().
// The ranking resolves names from the account, so a fixture where they disagree would be
// testing something that cannot happen.
async function user(_id, { online = true, lastActivity = new Date(), name = _id } = {}) {
  await Meteor.users.insertAsync({
    _id,
    profile: { name },
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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('registration', () => {
  it('registers all five jobs on the documented schedules', () => {
    expect(registeredCronJobs()).toEqual([HIGHSCORES, UNSTARTED, STALLED, RESUME, ABANDONED]);
    expect(cronSchedule(HIGHSCORES)).toBe('every 1 hour');
    expect(cronSchedule(UNSTARTED)).toBe('every 5 minutes');
    expect(cronSchedule(STALLED)).toBe('every 1 minute');
    expect(cronSchedule(RESUME)).toBe('every 1 minute');
    expect(cronSchedule(ABANDONED)).toBe('every 1 minute');
  });

  it('starts the scheduler on startup', async () => {
    await runStartup();
    expect(cronStarted()).toBe(true);
  });
});

describe('startup backfill', () => {
  // A game without `step` refuses every claim its turn chain makes, so games already in
  // flight when this ships have to be seeded before anything can drive them.
  it('seeds step on games that predate it and leaves the others alone', async () => {
    await Games.insertAsync({ name: 'old', started: true });
    await Games.insertAsync({ name: 'mid-turn', started: true, step: 7, lastStepAt: new Date(1) });

    await runStartup();

    expect(await Games.findOneAsync({ name: 'old' })).toMatchObject({ step: 0, lastStepAt: null });
    const untouched = await Games.findOneAsync({ name: 'mid-turn' });
    expect(untouched.step).toBe(7);
    expect(untouched.lastStepAt).toEqual(new Date(1));
  });

  // Five game fields and one player field are required keys that may be null. A document
  // written before that has the key missing, and the first whole-document write on such a
  // player — a `saveAsync()` mid-turn — is refused by the schema with a client-safe error
  // the server never logs, which stops the turn with nothing to read afterwards.
  it('seeds the nullable keys on documents that predate them', async () => {
    const old = await Games.insertAsync({ name: 'old', started: true });
    const midRespawn = await Games.insertAsync({
      name: 'mid-respawn',
      started: true,
      respawnPlayerId: 'p1',
      selectOptions: [{ x: 1, y: 1 }],
    });
    const bare = await Players.insertAsync({ gameId: old, name: 'ann' });
    const coated = await Players.insertAsync({ gameId: old, name: 'bob', ablativeCoat: 2 });
    // The frozen copies inside a snapshot need the same treatment: a restore writes them
    // back whole, so seeding only the live Players leaves a mid-segment game unresumable.
    const midSegment = await Games.insertAsync({
      name: 'mid-segment',
      started: true,
      segmentSnapshot: {
        segment: 'play',
        players: [
          { _id: bare, name: 'ann' },
          { _id: coated, name: 'bob', ablativeCoat: 2 },
        ],
        cards: [],
        deck: null,
      },
    });

    await runStartup();

    expect(await Games.findOneAsync(old)).toMatchObject({
      timerStartedAt: null,
      respawnPlayerId: null,
      respawnUserId: null,
      selectOptions: null,
      announceCard: null,
    });
    expect(await Games.findOneAsync(midRespawn)).toMatchObject({
      respawnPlayerId: 'p1',
      selectOptions: [{ x: 1, y: 1 }],
      announceCard: null,
    });
    expect((await Players.findOneAsync(bare)).ablativeCoat).toBeNull();
    expect((await Players.findOneAsync(coated)).ablativeCoat).toBe(2);
    const snapshot = (await Games.findOneAsync(midSegment)).segmentSnapshot;
    expect(snapshot.players.map((doc) => doc.ablativeCoat)).toEqual([null, 2]);
    expect(snapshot.segment).toBe('play'); // the rest of the snapshot survives the rewrite
  });

  // A turn that died with the previous process is picked up as the new one boots, not a
  // cron tick later. Same threshold as the job, so a game a still-running instance is
  // driving (rolling deploy) is left alone.
  it('sweeps for stalled turns once at startup', async () => {
    const resume = vi.spyOn(GameState, 'resumeAsync').mockResolvedValue();
    const dead = await insertGame({
      gamePhase: GameState.PHASE.RESPAWN,
      respawnPlayerId: null,
      lastStepAt: new Date(Date.now() - 2 * STALL_MS),
    });
    await insertGame({ gamePhase: GameState.PHASE.PLAY, lastStepAt: new Date() }); // live

    await runStartup();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(dead._id);
  });
});

describe(HIGHSCORES, () => {
  it('rebuilds the lists', async () => {
    await user('u1', { name: 'ann' });
    await Games.insertAsync({ winner: 'ann', winnerUserId: 'u1' });

    await runCronJob(HIGHSCORES);

    expect(await Highscores.findOneAsync({ type: 'mostWon' })).toMatchObject({ name: 'ann' });
  });
});

describe(STALLED, () => {
  beforeEach(() => vi.useFakeTimers());

  // A programming timer is a Meteor.setTimeout, so it dies with the process. These set
  // up the state a restart leaves behind — timer still 1, timerStartedAt long past —
  // which nothing else in the system recovers from.
  async function stalledGame({
    startedAt = null,
    gamePhase = GameState.PHASE.PROGRAM,
    timer = 1,
    lastStepAt = null,
  } = {}) {
    const game = await insertGame({ gamePhase, timer, timerStartedAt: startedAt, lastStepAt });
    const quick = await insertPlayer(game._id, { userId: 'a', name: 'ann', submitted: true });
    const slow = await insertPlayer(game._id, { userId: 'b', name: 'bob', submitted: false });
    // A legal hand, so the force-submit is an ordinary submission rather than the
    // exhausted-hand repair path.
    await insertCards(slow._id, game._id, {
      userId: 'b',
      handCards: [1, 2, 3, 4, 5],
      chosenCards: [1, 2, 3, 4, 5],
    });
    return { gameId: game._id, quick: quick._id, slow: slow._id };
  }

  const longAgo = () => new Date(Date.now() - (GameLogic.TIMER + 120) * 1000);

  it('force-submits the straggler when the timer died with the process', async () => {
    const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();
    const { gameId, slow } = await stalledGame({ startedAt: longAgo() });

    const running = runCronJob(STALLED);
    await vi.advanceTimersByTimeAsync(5000); // the job's own 2500ms settle delay
    await running;

    expect((await Players.findOneAsync(slow)).submitted).toBe(true);
    expect((await Games.findOneAsync(gameId)).timer).toBe(-1);
    expect(nextPhase).toHaveBeenCalledWith(gameId);
  });

  it('leaves a timer that is still within its window alone', async () => {
    const { gameId, slow } = await stalledGame({ startedAt: new Date(Date.now() - 5000) });

    const running = runCronJob(STALLED);
    await vi.advanceTimersByTimeAsync(5000);
    await running;

    expect((await Players.findOneAsync(slow)).submitted).toBe(false);
    expect((await Games.findOneAsync(gameId)).timer).toBe(1);
  });

  it('ignores a game that is not in the program phase', async () => {
    const { gameId, slow } = await stalledGame({
      startedAt: longAgo(),
      gamePhase: GameState.PHASE.PLAY,
    });

    const running = runCronJob(STALLED);
    await vi.advanceTimersByTimeAsync(5000);
    await running;

    expect((await Players.findOneAsync(slow)).submitted).toBe(false);
    expect((await Games.findOneAsync(gameId)).timer).toBe(1);
  });

  it('ignores a game with no timer running', async () => {
    const { gameId, slow } = await stalledGame({ startedAt: longAgo(), timer: -1 });

    const running = runCronJob(STALLED);
    await vi.advanceTimersByTimeAsync(5000);
    await running;

    expect((await Players.findOneAsync(slow)).submitted).toBe(false);
    expect((await Games.findOneAsync(gameId)).timer).toBe(-1);
  });

  it('is a no-op when nothing has stalled', async () => {
    const running = runCronJob(STALLED);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(running).resolves.not.toThrow();
  });

  // The timer can also die inside the 2.5 s grace after it fired: `timer: 0`,
  // `timerStartedAt` already cleared, and — if the straggler's tab is gone — nothing left
  // to re-send the submit. The arming claim's `lastStepAt` is the only clock that state has.
  describe('a timer lost in its grace window', () => {
    it('force-submits the straggler once the grace is long over', async () => {
      const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();
      const { gameId, slow } = await stalledGame({ timer: 0, lastStepAt: longAgo() });

      await runCronJob(STALLED);

      expect((await Players.findOneAsync(slow)).submitted).toBe(true);
      expect((await Games.findOneAsync(gameId)).timer).toBe(-1);
      expect(nextPhase).toHaveBeenCalledWith(gameId);
    });

    it('leaves a grace that may still be running to the live timeout', async () => {
      const { gameId, slow } = await stalledGame({
        timer: 0,
        lastStepAt: new Date(Date.now() - (GameLogic.TIMER + 5) * 1000),
      });

      await runCronJob(STALLED);

      expect((await Players.findOneAsync(slow)).submitted).toBe(false);
      expect((await Games.findOneAsync(gameId)).timer).toBe(0);
    });

    it('skips a dead robot and submits for the living straggler', async () => {
      const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();
      const game = await insertGame({
        gamePhase: GameState.PHASE.PROGRAM,
        timer: 0,
        lastStepAt: longAgo(),
      });
      // Out of lives, still `submitted: false` — inserted first, so a lookup without the
      // lives filter would pick it and re-arm the timer for a robot that cannot answer.
      const dead = await insertPlayer(game._id, {
        userId: 'x',
        name: 'x',
        lives: 0,
        submitted: false,
      });
      const quick = await insertPlayer(game._id, { userId: 'a', name: 'ann', submitted: true });
      const slow = await insertPlayer(game._id, { userId: 'b', name: 'bob', submitted: false });
      await insertCards(slow._id, game._id, {
        userId: 'b',
        handCards: [1, 2, 3, 4, 5],
        chosenCards: [1, 2, 3, 4, 5],
      });

      await runCronJob(STALLED);

      expect((await Players.findOneAsync(slow._id)).submitted).toBe(true);
      expect((await Players.findOneAsync(dead._id)).submitted).toBe(false);
      expect((await Players.findOneAsync(quick._id)).submitted).toBe(true);
      expect((await Games.findOneAsync(game._id)).timer).toBe(-1);
      expect(nextPhase).toHaveBeenCalledWith(game._id);
    });
  });
});

describe(RESUME, () => {
  beforeEach(() => vi.useFakeTimers());

  const stale = () => new Date(Date.now() - 2 * STALL_MS);
  const minimalSnapshot = (segment) => ({ segment, players: [], cards: [], deck: null });

  // Run the job, let every replay it started play out, and hand back its promises.
  async function sweep() {
    const replays = await runCronJob(RESUME);
    await vi.runAllTimersAsync();
    await Promise.all(replays);
    return replays;
  }

  function spyDispatchers() {
    return {
      game: vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue(),
      play: vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue(),
      respawn: vi.spyOn(GameState, 'nextRespawnPhaseAsync').mockResolvedValue(),
    };
  }

  const chatLines = async (gameId) =>
    (await Chat.find({ gameId }).fetchAsync()).map((c) => c.message);

  it('replays a turn whose driver died mid-register, and the turn runs to the next deal', async () => {
    stubBoard();
    const game = await insertGame({ gamePhase: GameState.PHASE.PROGRAM });
    const player = await insertPlayer(game._id, {
      submitted: true,
      cards: [-2, -2, -2, -2, -2],
    });
    // u-turn, turn-right, turn-left, turn-right, turn-left: five registers that leave the
    // robot on its square, so the replayed turn's outcome is easy to state.
    await insertCards(player._id, game._id, {
      handCards: [60, 61, 62, 63],
      chosenCards: [0, 6, 24, 7, 25],
    });
    await insertDeck(game._id, { cards: Array.from({ length: 30 }, (_, i) => 30 + i) });
    // Into PLAY for real — that claim takes the snapshot — but hold before register 1.
    const hold = vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();
    const entering = GameState.nextGamePhaseAsync(game._id);
    await vi.runAllTimersAsync();
    await entering;
    hold.mockRestore();
    expect((await Games.findOneAsync(game._id)).segmentSnapshot.segment).toBe(GameState.PHASE.PLAY);
    // What a process dying in register 3 leaves behind: the robot has moved and taken
    // damage, the document says mid-turn, and nothing has claimed the game since.
    await Players.updateAsync(player._id, { $set: { position: { x: 3, y: 3 }, damage: 2 } });
    await Games.updateAsync(game._id, {
      $set: { playPhase: GameState.PLAY_PHASE.MOVE_BOTS, playPhaseCount: 3, lastStepAt: stale() },
    });

    await sweep();

    // Registers 1–5, repairs, the next deal: a fresh program phase, everything reset.
    expect(await Games.findOneAsync(game._id)).toMatchObject({
      gamePhase: GameState.PHASE.PROGRAM,
      programRound: 2,
      playPhaseCount: 5,
    });
    expect(await Players.findOneAsync(player._id)).toMatchObject({
      position: { x: 0, y: 0 },
      damage: 0,
      submitted: false,
      playedCardsCnt: 0,
    });
    const messages = await chatLines(game._id);
    expect(messages.filter((m) => m === RESUME_CHAT)).toHaveLength(1);
  });

  it('leaves a game whose last claim is recent alone', async () => {
    const game = await insertGame({
      gamePhase: GameState.PHASE.PLAY,
      lastStepAt: new Date(Date.now() - STALL_MS / 2),
      segmentSnapshot: minimalSnapshot(GameState.PHASE.PLAY),
    });
    const d = spyDispatchers();

    await sweep();

    expect(d.play).not.toHaveBeenCalled();
    expect((await Games.findOneAsync(game._id)).step).toBe(0);
    expect(await chatLines(game._id)).toEqual([]);
  });

  it('leaves a program phase with someone still programming alone, however long they take', async () => {
    const game = await insertGame({
      gamePhase: GameState.PHASE.PROGRAM,
      lastStepAt: new Date(Date.now() - 100 * STALL_MS),
    });
    await insertPlayer(game._id, { submitted: true });
    await insertPlayer(game._id, { submitted: false });
    const d = spyDispatchers();

    await sweep();

    expect(d.game).not.toHaveBeenCalled();
    expect((await Games.findOneAsync(game._id)).step).toBe(0);
  });

  it('kicks a program phase where every living player has submitted', async () => {
    const game = await insertGame({
      gamePhase: GameState.PHASE.PROGRAM,
      timer: 0,
      lastStepAt: stale(),
    });
    await insertPlayer(game._id, { submitted: true });
    await insertPlayer(game._id, { submitted: false, lives: 0 });
    const d = spyDispatchers();

    await sweep();

    expect(d.game).toHaveBeenCalledWith(game._id);
    expect(await Games.findOneAsync(game._id)).toMatchObject({ timer: -1, timerStartedAt: null });
  });

  it('leaves a respawn waiting on a human alone', async () => {
    const game = await insertGame({
      gamePhase: GameState.PHASE.RESPAWN,
      respawnPlayerId: 'p1',
      selectOptions: [{ x: 1, y: 1 }],
      lastStepAt: new Date(Date.now() - 100 * STALL_MS),
    });
    const d = spyDispatchers();

    await sweep();

    expect(d.game).not.toHaveBeenCalled();
    expect(d.respawn).not.toHaveBeenCalled();
    expect((await Games.findOneAsync(game._id)).step).toBe(0);
  });

  it('re-prepares the options for a respawn whose options were never written', async () => {
    stubBoard();
    const game = await insertGame({
      gamePhase: GameState.PHASE.RESPAWN,
      respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_DIRECTION,
      lastStepAt: stale(),
    });
    const player = await insertPlayer(game._id, {
      userId: 'u1',
      start: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
    });
    await Games.updateAsync(game._id, {
      $set: { respawnPlayerId: player._id, selectOptions: null },
    });

    await sweep();

    const after = await Games.findOneAsync(game._id);
    expect(after.selectOptions).toHaveLength(4); // on its start square: every direction
    expect(after.respawnUserId).toBe('u1');
  });

  it('two sweeps in the same tick touch the game once', async () => {
    const game = await insertGame({
      gamePhase: GameState.PHASE.RESPAWN,
      respawnPlayerId: null,
      lastStepAt: stale(),
    });
    const d = spyDispatchers();

    const [a, b] = await Promise.all([runCronJob(RESUME), runCronJob(RESUME)]);
    await vi.runAllTimersAsync();
    await Promise.all([...a, ...b]);

    expect(d.game).toHaveBeenCalledTimes(1);
    expect((await Games.findOneAsync(game._id)).step).toBe(1); // the one touch
  });

  it('logs a failed replay, tells the players, and the job itself survives', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(GameState, 'resumeAsync').mockRejectedValue(new Error('simulated replay failure'));
    const game = await insertGame({ gamePhase: GameState.PHASE.PLAY, lastStepAt: stale() });

    await expect(sweep()).resolves.toHaveLength(1);

    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0]).toContain(game._id);
    expect(await chatLines(game._id)).toEqual([
      'The turn could not be resumed — the server will try again shortly.',
    ]);
  });

  it('is a no-op when nothing has stalled', async () => {
    await expect(sweep()).resolves.toEqual([]);
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
  beforeEach(() => {
    vi.useFakeTimers();
    // The job sits out the five minutes after boot (last test below). Startup ran earlier
    // in this file, at about the real time the fake clock starts from, so begin past it.
    vi.setSystemTime(Date.now() + BOOT_GRACE_MS);
  });

  // One test below overrides the grace through Meteor.settings; put it back either way.
  afterEach(() => setSettings());

  // mizzao:user-status marks every user offline in its own Meteor.startup, and clients
  // need seconds — after a long outage, minutes of DDP back-off — to reconnect. Without
  // the grace a restart could end every live game as "Nobody" or hand it to the first
  // player back.
  it('does nothing for five minutes after boot, then works again', async () => {
    const boot = new Date('2026-08-27T12:00:00Z');
    vi.setSystemTime(boot);
    await runStartup();
    await user('a', { online: false });
    const gameId = await Games.insertAsync({ started: true, min_player: 2 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });

    vi.setSystemTime(boot.getTime() + BOOT_GRACE_MS - 1000);
    await runWithRecheck(ABANDONED);
    expect((await Games.findOneAsync(gameId)).gamePhase).toBeUndefined();
    expect(await Chat.find({ gameId }).countAsync()).toBe(0);

    vi.setSystemTime(boot.getTime() + BOOT_GRACE_MS);
    await runWithRecheck(ABANDONED);
    expect((await Games.findOneAsync(gameId)).gamePhase).toBe(GameState.PHASE.ENDED);
  });

  // The default is measured against production's DDP back-off. A test run has no back-off
  // and no patience, so the grace is settable — test/e2e/settings.json drops it to ten
  // seconds, which is what lets an e2e run see this job clear games from an earlier run.
  it('takes a shorter grace from Meteor.settings.BOOT_GRACE_SEC', async () => {
    const boot = new Date('2026-08-27T12:00:00Z');
    vi.setSystemTime(boot);
    await runStartup();
    await user('a', { online: false });
    const gameId = await Games.insertAsync({ started: true, min_player: 2 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });

    // Ten seconds in, the default grace would still be sitting this one out.
    vi.setSystemTime(boot.getTime() + 10_000);
    await runWithRecheck(ABANDONED);
    expect((await Games.findOneAsync(gameId)).gamePhase).toBeUndefined();

    setSettings({ BOOT_GRACE_SEC: 10 });
    vi.setSystemTime(boot.getTime() + 10_000);
    await runWithRecheck(ABANDONED);
    expect((await Games.findOneAsync(gameId)).gamePhase).toBe(GameState.PHASE.ENDED);
  });

  // Ending a game is a transition, so it has to take the claim like every other write in
  // the turn chain. It used to be a plain update, which left `step` alone — and the
  // stalled-turn sweep replaying a PLAY segment takes ~30 s while this job ticks every
  // minute, so a driver was very often still inside the turn. Its next claim still matched
  // and wrote the game back to a live phase, leaving it ENDED and live at once. This job
  // filters on a missing `winner`, so it never looked at that game again.
  it('cannot be written over by a driver still inside the turn', async () => {
    await user('a', { online: false });
    const gameId = await Games.insertAsync({
      started: true,
      min_player: 2,
      step: 7,
      gamePhase: GameState.PHASE.PLAY,
      playPhase: GameState.PLAY_PHASE.MOVE_BOTS,
    });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });
    // What a replay holds while it runs: the document as it was when it took its claim.
    const driver = await Games.findOneAsync(gameId);

    await runWithRecheck(ABANDONED);

    const claimed = await driver.advanceAsync({
      $set: { playPhase: GameState.PLAY_PHASE.LASERS },
    });

    expect(claimed).toBe(false);
    const game = await Games.findOneAsync(gameId);
    expect(game.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(game.winner).toBe('Nobody');
  });

  it("ends a game with winner 'Nobody' when every player has gone", async () => {
    await user('a', { online: false });
    const gameId = await Games.insertAsync({ started: true, min_player: 2 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });

    await runWithRecheck(ABANDONED);

    const game = await Games.findOneAsync(gameId);
    expect(game.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(game.winner).toBe('Nobody');
    // No winnerUserId: its absence is exactly what keeps this game out of the ranking.
    expect(game.winnerUserId).toBeUndefined();
    expect(game.stopped).toBeTypeOf('number');
  });

  it('awards the win to the last player still connected', async () => {
    await user('a', { online: true, name: 'ann' });
    await user('b', { online: false, name: 'bob' });
    const gameId = await Games.insertAsync({ started: true, min_player: 2 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'ann' });
    await Players.insertAsync({ gameId, userId: 'b', name: 'bob' });

    await runWithRecheck(ABANDONED);

    const game = await Games.findOneAsync(gameId);
    expect(game.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(game.winner).toBe('ann');
    // The display name is for the board; the userId is what the ranking groups on.
    expect(game.winnerUserId).toBe('a');
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
