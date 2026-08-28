// `advanceAsync` is the compare-and-set every write in the turn chain claims through, so
// it is pinned here on its own: what a winning claim writes, what a losing one does not,
// and how a caller's own modifier merges with the step bump.
import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { Games } from '../../collections/games.js';
import { insertGame } from '../helpers/fixtures.js';

beforeEach(() => resetFakeCollections());

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
