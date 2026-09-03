// `advanceAsync` is the compare-and-set every write in the turn chain claims through, so
// it is pinned here on its own: what a winning claim writes, what a losing one does not,
// and how a caller's own modifier merges with the step bump.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { GameState } from '../../both/gamestate.ts';
import { Games } from '../../collections/games.ts';
import { insertGame } from '../helpers/fixtures.js';

beforeEach(() => resetFakeCollections());
afterEach(() => vi.restoreAllMocks());

describe('advanceAsync', () => {
  it('increments step, stamps lastStepAt and applies the caller $set', async () => {
    const game = await insertGame({ gamePhase: 'program' });
    const before = Date.now();

    expect(await game.advanceAsync({ $set: { gamePhase: 'play' } })).toBe(true);

    const stored = await Games.findOneAsync(game._id);
    expect(stored.step).toBe(1);
    expect(stored.gamePhase).toBe('play');
    expect(stored.lastStepAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('leaves the instance current with what it wrote', async () => {
    const game = await insertGame({ gamePhase: 'program' });

    await game.advanceAsync({ $set: { gamePhase: 'play' } });

    expect(game.step).toBe(1);
    expect(game.gamePhase).toBe('play');
    expect(game.lastStepAt).toBeInstanceOf(Date);
    // Still the same instance, so a second claim off it wins too.
    expect(await game.advanceAsync({ $set: { gamePhase: 'deal' } })).toBe(true);
    expect((await Games.findOneAsync(game._id)).step).toBe(2);
  });

  it('claims with no modifier at all', async () => {
    const game = await insertGame();

    expect(await game.advanceAsync()).toBe(true);
    expect((await Games.findOneAsync(game._id)).step).toBe(1);
  });

  it('merges the caller $inc with the step bump', async () => {
    const game = await insertGame({ programRound: 1 });

    await game.advanceAsync({ $set: { gamePhase: 'program' }, $inc: { programRound: 1 } });

    const stored = await Games.findOneAsync(game._id);
    expect(stored.programRound).toBe(2);
    expect(stored.step).toBe(1);
    // The instance follows the $inc too, not only the $set.
    expect(game.programRound).toBe(2);
  });

  it('returns false and writes nothing when the instance is stale', async () => {
    const winner = await insertGame({ gamePhase: 'program' });
    const loser = await Games.findOneAsync(winner._id); // same step, read separately

    expect(await winner.advanceAsync({ $set: { gamePhase: 'play' } })).toBe(true);
    expect(await loser.advanceAsync({ $set: { gamePhase: 'ended' } })).toBe(false);

    const stored = await Games.findOneAsync(winner._id);
    expect(stored.gamePhase).toBe('play');
    expect(stored.step).toBe(1);
    // The loser's instance is untouched too, so it cannot go on believing it wrote.
    expect(loser.step).toBe(0);
    expect(loser.gamePhase).toBe('program');
  });

  it('a losing claim does not run the caller $inc either', async () => {
    const winner = await insertGame({ programRound: 1 });
    const loser = await Games.findOneAsync(winner._id);

    await winner.advanceAsync();
    await loser.advanceAsync({ $inc: { programRound: 1 } });

    expect((await Games.findOneAsync(winner._id)).programRound).toBe(1);
  });

  it('lets exactly one of two concurrent claims through', async () => {
    const a = await insertGame({ gamePhase: 'program' });
    const b = await Games.findOneAsync(a._id);

    const results = await Promise.all([
      a.advanceAsync({ $set: { gamePhase: 'play' } }),
      b.advanceAsync({ $set: { gamePhase: 'deal' } }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await Games.findOneAsync(a._id)).step).toBe(1);
  });
});

// The phase setters the state machine calls are claims too, and the `next*Async(phase)`
// wrappers must not dispatch a phase whose claim they lost.
describe('the phase wrappers', () => {
  it('each setter resolves to its claim result and moves step', async () => {
    const game = await insertGame();

    expect(await game.setPlayPhaseAsync('reveal')).toBe(true);
    expect(await game.setGamePhaseAsync('play')).toBe(true);
    expect(await game.setRespawnPhaseAsync('choose direction')).toBe(true);
    expect(await game.startAnnounceAsync()).toBe(true);
    expect(await game.stopAnnounceAsync()).toBe(true);

    expect(await Games.findOneAsync(game._id)).toMatchObject({
      step: 5,
      playPhase: 'reveal',
      gamePhase: 'play',
      respawnPhase: 'choose direction',
      announce: false,
    });
  });

  it('a setter on a stale instance returns false and writes nothing', async () => {
    const winner = await insertGame({ playPhase: 'waiting' });
    const loser = await Games.findOneAsync(winner._id);

    await winner.setPlayPhaseAsync('reveal');

    expect(await loser.setPlayPhaseAsync('move bots')).toBe(false);
    expect(await loser.startAnnounceAsync()).toBe(false);
    expect(await Games.findOneAsync(winner._id)).toMatchObject({
      playPhase: 'reveal',
      announce: false,
      step: 1,
    });
  });

  it('next*Async(phase) dispatches only when its claim wins', async () => {
    const dispatch = vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();
    const winner = await insertGame();
    const loser = await Games.findOneAsync(winner._id);

    await winner.nextPlayPhaseAsync('reveal');
    expect(dispatch).toHaveBeenCalledTimes(1);

    await loser.nextPlayPhaseAsync('move bots');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await Games.findOneAsync(winner._id)).playPhase).toBe('reveal');
  });

  it('next*Async() with no phase claims nothing and just dispatches', async () => {
    const dispatch = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();
    const game = await insertGame();

    await game.nextGamePhaseAsync();

    expect(dispatch).toHaveBeenCalledWith(game._id);
    expect((await Games.findOneAsync(game._id)).step).toBe(0);
  });
});
