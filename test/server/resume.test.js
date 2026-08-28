// The sweep's selection on its own: which games resumeStalledTurnsAsync hands to
// GameState.resumeAsync and which it leaves alone. What resumeAsync then does to a game is
// test/both/gamestate.test.js's business; the cron wiring is test/server/cron.test.js's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { insertGame } from '../helpers/fixtures.js';
import { GameState } from '../../both/gamestate.js';
import { Chat } from '../../collections/chat.js';
import { needsDriver, resumeStalledTurnsAsync, STALL_MS } from '../../server/resume.js';

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
