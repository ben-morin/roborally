// The sweep's selection on its own: which games resumeStalledTurnsAsync hands to
// GameState.resumeAsync and which it leaves alone. What resumeAsync then does to a game is
// test/both/gamestate.test.js's business; the cron wiring is test/server/cron.test.js's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { GameState } from '../../both/gamestate.ts';
import { Chat } from '../../collections/chat.ts';
import { markBooted } from '../../server/boot.ts';
import { Games } from '../../collections/games.ts';
import {
  MAX_RESUME_ATTEMPTS,
  needsDriver,
  nudgeGameAsync,
  resumeStalledTurnsAsync,
  STALL_MS,
} from '../../server/resume.ts';

const { DEAL, PLAY, PROGRAM, RESPAWN, IDLE, ENDED } = GameState.PHASE;
const NOW = new Date('2026-08-27T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);
const sweep = () => resumeStalledTurnsAsync({ now: NOW });

beforeEach(() => resetFakeCollections());
afterEach(() => vi.restoreAllMocks());

describe('needsDriver', () => {
  it.each([
    [DEAL, {}, true],
    [PLAY, {}, true],
    // Handed over: whether everyone has submitted takes the Players, so resumeAsync decides.
    [PROGRAM, {}, true],
    [RESPAWN, { respawnPlayerId: null }, true],
    [RESPAWN, { respawnPlayerId: 'p1', selectOptions: null }, true],
    [RESPAWN, { respawnPlayerId: 'p1', selectOptions: [{ x: 1, y: 1 }] }, false],
    [IDLE, {}, false],
    [ENDED, {}, false],
  ])('%s %j → %s', (gamePhase, rest, expected) => {
    expect(needsDriver({ gamePhase, ...rest })).toBe(expected);
  });
});

describe('resumeStalledTurnsAsync', () => {
  const spyResume = () => vi.spyOn(GameState, 'resumeAsync').mockResolvedValue();

  it('hands over a started game whose last claim is older than the threshold', async () => {
    const resume = spyResume();
    const game = await insertGame({ gamePhase: PLAY, lastStepAt: ago(STALL_MS + 1) });

    const replays = await sweep();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(game._id);
    expect(replays).toHaveLength(1);
  });

  it('leaves a game whose last claim is within the threshold — the boundary included', async () => {
    const resume = spyResume();
    await insertGame({ gamePhase: PLAY, lastStepAt: ago(STALL_MS - 1) });
    await insertGame({ gamePhase: PLAY, lastStepAt: ago(STALL_MS) }); // $lt: not yet

    expect(await sweep()).toEqual([]);
    expect(resume).not.toHaveBeenCalled();
  });

  it('never sweeps a game that has made no claim yet', async () => {
    const resume = spyResume();
    // Created or backfilled before its first claim: nothing to restore it from either.
    await insertGame({ gamePhase: PLAY, lastStepAt: null });
    await insertGame({ gamePhase: PLAY }); // the field missing altogether

    expect(await sweep()).toEqual([]);
    expect(resume).not.toHaveBeenCalled();
  });

  it('never sweeps a game that has not started or has ended', async () => {
    const resume = spyResume();
    await insertGame({ gamePhase: IDLE, started: false, lastStepAt: ago(STALL_MS * 10) });
    await insertGame({ gamePhase: ENDED, winner: 'ann', lastStepAt: ago(STALL_MS * 10) });

    expect(await sweep()).toEqual([]);
    expect(resume).not.toHaveBeenCalled();
  });

  it('leaves a respawn waiting on a human, however long the human takes', async () => {
    const resume = spyResume();
    await insertGame({
      gamePhase: RESPAWN,
      respawnPlayerId: 'p1',
      selectOptions: [{ x: 1, y: 1 }],
      lastStepAt: ago(STALL_MS * 100),
    });
    const noOptions = await insertGame({
      gamePhase: RESPAWN,
      respawnPlayerId: 'p1',
      selectOptions: null,
      lastStepAt: ago(STALL_MS * 100),
    });

    await sweep();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(noOptions._id);
  });

  it('measures the stall from the `now` it is given', async () => {
    const resume = spyResume();
    const game = await insertGame({ gamePhase: DEAL, lastStepAt: NOW });

    await resumeStalledTurnsAsync({ now: new Date(NOW.getTime() + STALL_MS) });
    expect(resume).not.toHaveBeenCalled();
    await resumeStalledTurnsAsync({ now: new Date(NOW.getTime() + STALL_MS + 1) });
    expect(resume).toHaveBeenCalledWith(game._id);
  });

  it('returns one promise per game, each settling even when its replay fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = await insertGame({ gamePhase: PLAY, lastStepAt: ago(STALL_MS * 2) });
    const fine = await insertGame({ gamePhase: DEAL, lastStepAt: ago(STALL_MS * 2) });
    vi.spyOn(GameState, 'resumeAsync').mockImplementation(async (gameId) => {
      if (gameId === failing._id) throw new Error('simulated replay failure');
    });

    const replays = await sweep();
    expect(replays).toHaveLength(2);
    await expect(Promise.all(replays)).resolves.toEqual([undefined, undefined]);

    // The failure is logged with the gameId and told to that game's players — and only
    // that game's.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0]).toContain(failing._id);
    expect((await Chat.find({ gameId: failing._id }).fetchAsync()).map((c) => c.message)).toEqual([
      'The turn could not be resumed — the server will try again shortly.',
    ]);
    expect(await Chat.find({ gameId: fine._id }).countAsync()).toBe(0);
  });

  it('is a no-op with nothing stalled', async () => {
    const resume = spyResume();

    expect(await sweep()).toEqual([]);
    expect(resume).not.toHaveBeenCalled();
  });
});

// The cap on replay attempts. A failed attempt has already stamped `lastStepAt`, so
// without a cap the sweep picks the same game up every minute for as long as a player
// stays online — see MAX_RESUME_ATTEMPTS.
describe('the replay attempt cap', () => {
  const RETRY_LINE = 'The turn could not be resumed — the server will try again shortly.';
  const CAPPED_LINE =
    'The turn could not be resumed after 3 attempts. The game is parked; it will be ended when everyone leaves.';

  const failingGame = async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return await insertGame({ gamePhase: PLAY, lastStepAt: ago(STALL_MS * 2) });
  };
  const failEveryReplay = () =>
    vi.spyOn(GameState, 'resumeAsync').mockRejectedValue(new Error('simulated replay failure'));
  const attemptsOn = async (gameId) => (await Games.findOneAsync(gameId)).resumeAttempts;
  const chatOn = async (gameId) => (await Chat.find({ gameId }).fetchAsync()).map((c) => c.message);
  // The sweep hands over promises; the count is written inside them.
  const sweepAndWait = async () => await Promise.all(await sweep());

  it('counts a failed replay on the game', async () => {
    const game = await failingGame();
    failEveryReplay();

    await sweepAndWait();
    expect(await attemptsOn(game._id)).toBe(1);

    await sweepAndWait();
    expect(await attemptsOn(game._id)).toBe(2);
  });

  it('stops sweeping a game at the cap, and says so once', async () => {
    const game = await failingGame();
    const resume = failEveryReplay();

    for (let i = 0; i < MAX_RESUME_ATTEMPTS + 2; i++) await sweepAndWait();

    expect(resume).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS);
    expect(await attemptsOn(game._id)).toBe(MAX_RESUME_ATTEMPTS);
    // The last attempt says the game is parked; the ones before it promise another try.
    expect(await chatOn(game._id)).toEqual([RETRY_LINE, RETRY_LINE, CAPPED_LINE]);
  });

  it('forgets earlier failures once a replay gets through', async () => {
    const game = await failingGame();
    failEveryReplay();
    await sweepAndWait();
    expect(await attemptsOn(game._id)).toBe(1);

    vi.spyOn(GameState, 'resumeAsync').mockResolvedValue();
    await sweepAndWait();

    expect(await attemptsOn(game._id)).toBeUndefined();
  });
});

// The short circuit the sweep cannot offer: a player opening the board says "I am here"
// before `lastStepAt` has aged STALL_MS and before the cron's next tick. It gives that up
// only for a claim older than this process's boot, which no driver in this process can have
// written — see the comment on nudgeGameAsync.
describe('nudgeGameAsync', () => {
  const BOOT = new Date('2026-08-27T12:00:00Z');
  const beforeBoot = new Date(BOOT.getTime() - 1);
  const afterBoot = new Date(BOOT.getTime() + 1);

  const spyResume = () => vi.spyOn(GameState, 'resumeAsync').mockResolvedValue();
  const stalledGame = (overrides = {}) =>
    insertGame({ gamePhase: PLAY, lastStepAt: beforeBoot, ...overrides });

  beforeEach(() => markBooted(BOOT.getTime()));
  afterEach(() => markBooted(0));

  it('resumes at once for a player of the game, without waiting out the threshold', async () => {
    const resume = spyResume();
    const game = await stalledGame();
    await insertPlayer(game._id, { userId: 'u1' });

    await expect(nudgeGameAsync(game._id, 'u1')).resolves.toBe(true);

    expect(resume).toHaveBeenCalledWith(game._id);
    // The sweep would still be sitting this one out: the claim is one millisecond old.
    vi.spyOn(GameState, 'resumeAsync').mockClear();
    expect(await resumeStalledTurnsAsync({ now: beforeBoot })).toHaveLength(0);
  });

  it('declines for a logged-in onlooker who is not a player of the game', async () => {
    const resume = spyResume();
    const game = await stalledGame();
    await insertPlayer(game._id, { userId: 'someone-else' });

    await expect(nudgeGameAsync(game._id, 'u1')).resolves.toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  it('declines when nobody is logged in', async () => {
    const resume = spyResume();
    const game = await stalledGame();
    await insertPlayer(game._id, { userId: 'u1' });

    await expect(nudgeGameAsync(game._id, null)).resolves.toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  it('declines when the last claim is not older than boot — the boundary included', async () => {
    const resume = spyResume();
    const atBoot = await stalledGame({ lastStepAt: BOOT });
    const since = await stalledGame({ lastStepAt: afterBoot });
    await insertPlayer(atBoot._id, { userId: 'u1' });
    await insertPlayer(since._id, { userId: 'u1' });

    await expect(nudgeGameAsync(atBoot._id, 'u1')).resolves.toBe(false);
    await expect(nudgeGameAsync(since._id, 'u1')).resolves.toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  it('declines a game that has never been claimed, which has no snapshot to restore', async () => {
    const resume = spyResume();
    const game = await stalledGame({ lastStepAt: null });
    await insertPlayer(game._id, { userId: 'u1' });

    await expect(nudgeGameAsync(game._id, 'u1')).resolves.toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  it('declines a game that is waiting on a human, or on nothing at all', async () => {
    const resume = spyResume();
    const respawning = await stalledGame({
      gamePhase: RESPAWN,
      respawnPlayerId: 'p1',
      selectOptions: [{ x: 1, y: 1 }],
    });
    const over = await stalledGame({ gamePhase: ENDED });
    await insertPlayer(respawning._id, { userId: 'u1' });
    await insertPlayer(over._id, { userId: 'u1' });

    await expect(nudgeGameAsync(respawning._id, 'u1')).resolves.toBe(false);
    await expect(nudgeGameAsync(over._id, 'u1')).resolves.toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  it('declines a game that has used up its replay attempts', async () => {
    const resume = spyResume();
    const game = await stalledGame({ resumeAttempts: MAX_RESUME_ATTEMPTS });
    await insertPlayer(game._id, { userId: 'u1' });

    await expect(nudgeGameAsync(game._id, 'u1')).resolves.toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  it('declines a game that is not there', async () => {
    const resume = spyResume();
    await expect(nudgeGameAsync('gone', 'u1')).resolves.toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });
});
