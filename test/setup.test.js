// Tests for the fake itself. Everything else in the suite trusts FakeCollection to behave
// like Mongo, so the pieces that were added for a reason — rather than copied from the
// driver — get their own coverage here: $push, exclusion projections and the crash hook
// the resumable-turn property test drives.
import { beforeEach, describe, expect, it } from 'vitest';
import { crashAtWrite, resetFakeCollections, SimulatedCrash, writeCount } from './setup.js';

const docs = new Meteor.Collection('scratch');
const others = new Meteor.Collection('scratch_others');

beforeEach(() => resetFakeCollections());

describe('$push', () => {
  it('creates the array when the field is missing', async () => {
    const id = await docs.insertAsync({ name: 'a' });
    await docs.updateAsync(id, { $push: { queue: 'p1' } });
    expect((await docs.findOneAsync(id)).queue).toEqual(['p1']);
  });

  it('appends to an existing array, in order', async () => {
    const id = await docs.insertAsync({ queue: ['p1'] });
    await docs.updateAsync(id, { $push: { queue: 'p2' } });
    await docs.updateAsync(id, { $push: { queue: 'p3' } });
    expect((await docs.findOneAsync(id)).queue).toEqual(['p1', 'p2', 'p3']);
  });

  it('pushes a subdocument and reaches a dotted path', async () => {
    const id = await docs.insertAsync({ state: {} });
    await docs.updateAsync(id, { $push: { 'state.log': { at: 1 } } });
    expect((await docs.findOneAsync(id)).state.log).toEqual([{ at: 1 }]);
  });

  it('throws on $each rather than half-implementing it', async () => {
    const id = await docs.insertAsync({ queue: [] });
    await expect(docs.updateAsync(id, { $push: { queue: { $each: [1, 2] } } })).rejects.toThrow(
      /unsupported \$push option/
    );
  });

  it('throws when the field is not an array', async () => {
    const id = await docs.insertAsync({ queue: 'not an array' });
    await expect(docs.updateAsync(id, { $push: { queue: 'p1' } })).rejects.toThrow(
      /\$push on non-array field/
    );
  });
});

describe('field projection', () => {
  it('excludes the named field and keeps the rest', async () => {
    await docs.insertAsync({ name: 'a', snapshot: { big: true }, step: 3 });
    expect(docs.findOne({}, { fields: { snapshot: 0 } })).toEqual({
      _id: 'scratch_1',
      name: 'a',
      step: 3,
    });
  });

  it('excludes a dotted path and drops _id when asked', async () => {
    await docs.insertAsync({ state: { keep: 1, drop: 2 } });
    expect(docs.findOne({}, { fields: { 'state.drop': 0, _id: 0 } })).toEqual({
      state: { keep: 1 },
    });
  });

  it('still supports inclusion', async () => {
    await docs.insertAsync({ name: 'a', snapshot: { big: true } });
    expect(docs.findOne({}, { fields: { name: 1 } })).toEqual({ _id: 'scratch_1', name: 'a' });
  });

  it('throws when inclusion and exclusion are mixed', async () => {
    await docs.insertAsync({ name: 'a', snapshot: {} });
    expect(() => docs.findOne({}, { fields: { name: 1, snapshot: 0 } })).toThrow(
      /cannot mix inclusion and exclusion/
    );
  });
});

describe('the crash hook', () => {
  it('counts every async mutator, across collections', async () => {
    expect(writeCount()).toBe(0);
    const id = await docs.insertAsync({ n: 1 });
    await others.insertAsync({ n: 2 });
    await docs.updateAsync(id, { $inc: { n: 1 } });
    await docs.removeAsync(id);
    expect(writeCount()).toBe(4);
  });

  it('counts an upsert once, whether it inserts or updates', async () => {
    await docs.upsertAsync({ key: 'k' }, { $set: { n: 1 } });
    await docs.upsertAsync({ key: 'k' }, { $set: { n: 2 } });
    expect(writeCount()).toBe(2);
    expect((await docs.findOneAsync({ key: 'k' })).n).toBe(2);
  });

  it('crashing before a write leaves the document untouched', async () => {
    const id = await docs.insertAsync({ n: 1 });
    crashAtWrite(2, 'before');
    await expect(docs.updateAsync(id, { $set: { n: 99 } })).rejects.toThrow(SimulatedCrash);
    expect((await docs.findOneAsync(id)).n).toBe(1);
  });

  it('crashing after a write applies it first', async () => {
    const id = await docs.insertAsync({ n: 1 });
    crashAtWrite(2, 'after');
    await expect(docs.updateAsync(id, { $set: { n: 99 } })).rejects.toThrow(SimulatedCrash);
    expect((await docs.findOneAsync(id)).n).toBe(99);
  });

  it('fires on exactly the armed write and lets the others through', async () => {
    crashAtWrite(2, 'before');
    await docs.insertAsync({ n: 1 });
    await expect(docs.insertAsync({ n: 2 })).rejects.toThrow(SimulatedCrash);
    await docs.insertAsync({ n: 3 });
    expect(
      docs
        .find({})
        .fetch()
        .map((d) => d.n)
    ).toEqual([1, 3]);
  });

  it('disarms on crashAtWrite(null) and on a reset, which also zeroes the counter', async () => {
    crashAtWrite(1, 'before');
    crashAtWrite(null);
    await docs.insertAsync({ n: 1 });

    crashAtWrite(2, 'before');
    resetFakeCollections();
    expect(writeCount()).toBe(0);
    await docs.insertAsync({ n: 1 });
    await docs.insertAsync({ n: 2 });
    expect(writeCount()).toBe(2);
  });

  it('rejects a "when" it does not understand', () => {
    expect(() => crashAtWrite(1, 'during')).toThrow(/"before" or "after"/);
  });
});
