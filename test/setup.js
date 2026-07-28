// Vitest setupFile: makes the game model importable outside Meteor.
//
// Ground truth (see MODERNIZATION.local.md, Milestone 3 kickoff): the M2 import graph
// means even "pure" classes like Tile transitively import collections that call
// `new Meteor.Collection(...)` at module-body time. Without a `Meteor` global, every
// both/*.js file except area.js and shuffle.js throws `ReferenceError: Meteor is not
// defined` on import.
//
// FakeCollection is a real (if minimal) in-memory Mongo-alike rather than an inert
// stub: CardLogic/GameLogic/GameState tests drive genuine read-mutate-updateAsync
// round trips through Games/Players/Cards/Deck, the same way the app does. Only the
// operators actually used by both/ and collections/ are implemented (equality,
// dotted paths, $gt/$gte/$lt/$lte/$ne/$exists, $set/$inc on write) — anything wider
// throws loudly rather than silently mismatching.

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function matchesSelector(doc, selector) {
  if (typeof selector === 'string') return doc._id === selector;
  return Object.entries(selector).every(([key, cond]) => {
    const val = getPath(doc, key);
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, opVal]) => {
        switch (op) {
          case '$gt':
            return val > opVal;
          case '$gte':
            return val >= opVal;
          case '$lt':
            return val < opVal;
          case '$lte':
            return val <= opVal;
          case '$ne':
            return val !== opVal;
          case '$exists':
            return (val !== undefined) === opVal;
          default:
            throw new Error(`FakeCollection: unsupported query operator "${op}"`);
        }
      });
    }
    return val === cond;
  });
}

function applyModifier(doc, modifier) {
  const hasOperators = Object.keys(modifier).some((k) => k.startsWith('$'));
  if (!hasOperators) {
    // Whole-document replace, Meteor-style: keep _id, replace every other own field.
    const { _id } = doc;
    for (const key of Object.keys(doc)) delete doc[key];
    Object.assign(doc, modifier);
    doc._id = _id;
    return;
  }
  for (const [op, fields] of Object.entries(modifier)) {
    switch (op) {
      case '$set':
        for (const [path, value] of Object.entries(fields)) setPath(doc, path, value);
        break;
      case '$inc':
        for (const [path, value] of Object.entries(fields)) {
          setPath(doc, path, (getPath(doc, path) || 0) + value);
        }
        break;
      default:
        throw new Error(`FakeCollection: unsupported update operator "${op}"`);
    }
  }
}

class FakeCursor {
  constructor(docs, transform) {
    this._docs = docs;
    this._transform = transform;
  }

  _snapshot() {
    return this._docs.map((d) => {
      const clone = structuredClone(d);
      return this._transform ? this._transform(clone) : clone;
    });
  }

  fetch() {
    return this._snapshot();
  }

  fetchAsync() {
    return Promise.resolve(this.fetch());
  }

  count() {
    return this._docs.length;
  }

  countAsync() {
    return Promise.resolve(this.count());
  }

  observe() {
    return { stop() {} };
  }
}

const allFakeCollections = [];

class FakeCollection {
  constructor(name, options = {}) {
    this.name = name;
    this._docs = new Map();
    this._seq = 0;
    this._transform = options.transform;
    allFakeCollections.push(this);
  }

  _reset() {
    this._docs.clear();
    this._seq = 0;
  }

  _rawMatches(selector) {
    if (selector == null) return [...this._docs.values()];
    if (typeof selector === 'string') {
      const doc = this._docs.get(selector);
      return doc ? [doc] : [];
    }
    return [...this._docs.values()].filter((d) => matchesSelector(d, selector));
  }

  find(selector) {
    return new FakeCursor(this._rawMatches(selector), this._transform);
  }

  findOne(selector) {
    const [doc] = this._rawMatches(selector);
    if (!doc) return undefined;
    const clone = structuredClone(doc);
    return this._transform ? this._transform(clone) : clone;
  }

  findOneAsync(selector) {
    return Promise.resolve(this.findOne(selector));
  }

  insertAsync(doc) {
    const _id = doc._id || `${this.name}_${++this._seq}`;
    this._docs.set(_id, structuredClone({ ...doc, _id }));
    return Promise.resolve(_id);
  }

  updateAsync(selector, modifier, options = {}) {
    const matches = this._rawMatches(selector);
    const targets = options.multi ? matches : matches.slice(0, 1);
    for (const doc of targets) applyModifier(doc, modifier);
    return Promise.resolve(targets.length);
  }

  async upsertAsync(selector, modifier) {
    const [existing] = this._rawMatches(selector);
    if (existing) {
      applyModifier(existing, modifier);
      return { numberAffected: 1 };
    }
    const literalFields = {};
    if (selector && typeof selector === 'object') {
      for (const [k, v] of Object.entries(selector)) {
        if (!v || typeof v !== 'object') literalFields[k] = v;
      }
    }
    const base = { ...literalFields };
    const hasOperators = Object.keys(modifier).some((k) => k.startsWith('$'));
    if (hasOperators) {
      applyModifier(base, modifier);
    } else {
      Object.assign(base, modifier);
    }
    const insertedId = await this.insertAsync(base);
    return { numberAffected: 1, insertedId };
  }

  removeAsync(selector) {
    const matches = this._rawMatches(selector);
    for (const doc of matches) this._docs.delete(doc._id);
    return Promise.resolve(matches.length);
  }

  allow() {}
  deny() {}
  rawCollection() {
    return {};
  }
}

export function resetFakeCollections() {
  for (const c of allFakeCollections) c._reset();
}

globalThis.Meteor = {
  Collection: FakeCollection,
  isServer: true,
  isClient: false,
  isProduction: false,
  isDevelopment: true,
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (h) => clearInterval(h),
  methods() {},
  publish() {},
  startup(f) {
    f();
  },
  userId: () => null,
  users: new FakeCollection('users'),
  bindEnvironment: (f) => f,
  Error: class MeteorError extends Error {
    constructor(c, m) {
      super(m);
      this.error = c;
      this.reason = m;
    }
  },
};

globalThis.Random = { id: () => 'rnd' + Math.random().toString(36).slice(2, 9) };

// Board/Area construction logs to stdout on every build ("Load risky_exchange board",
// "Start 5,3,up", "Checkpoint 1 located at 7,1", ...). both/logging.js only silences
// this in production and isn't part of the both/ import graph under test, so silence
// it here instead of flipping Meteor.isProduction (which would change what the code
// under test does).
console.log = () => {};
