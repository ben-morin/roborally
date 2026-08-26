// Vitest setupFile: makes the game model and the server importable outside Meteor.
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
// operators actually used by both/, collections/ and server/ are implemented (equality,
// dotted paths, $gt/$gte/$lt/$lte/$ne/$exists, $set/$inc on write, sort/skip/limit and
// inclusion-only `fields` on find, and a four-stage aggregate) — anything wider throws
// loudly rather than silently mismatching.
//
// The second half of this file is the server harness: Meteor.methods/publish/startup
// capture what server/ registers instead of discarding it, Meteor.callAsync dispatches
// to a real handler, and loginAs() supplies the current user that every method's auth
// branch reads. That is what lets test/server/*.test.js drive the actual production
// handlers rather than a reimplementation of them.

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

// Mongo resolves a dotted path through arrays of subdocuments: `{'emails.address': x}`
// matches when ANY element of `emails` has that address (server/methods.js's
// resendVerificationEmail relies on this). Returns every candidate value the path
// reaches — one entry for a plain nested field, N for an array, none when an array
// holds no element carrying the key.
function getPathValues(obj, path) {
  let current = [obj];
  for (const key of path.split('.')) {
    const next = [];
    for (const value of current) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const element of value) {
          if (element != null && typeof element === 'object' && key in element) {
            next.push(element[key]);
          }
        }
      } else if (typeof value === 'object') {
        next.push(value[key]);
      }
    }
    current = next;
  }
  return current;
}

function matchesSelector(doc, selector) {
  if (typeof selector === 'string') return doc._id === selector;
  return Object.entries(selector).every(([key, cond]) => {
    const values = getPathValues(doc, key);
    // Positive operators match when SOME candidate satisfies them; the negative ones are
    // the negation of that, which is how Mongo defines them over arrays.
    const some = (predicate) => values.some(predicate);
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, opVal]) => {
        switch (op) {
          case '$gt':
            return some((v) => v > opVal);
          case '$gte':
            return some((v) => v >= opVal);
          case '$lt':
            return some((v) => v < opVal);
          case '$lte':
            return some((v) => v <= opVal);
          case '$ne':
            // $ne is the negation of $eq, so it inherits $eq's treatment of null:
            // `{f: {$ne: 'x'}}` matches a document missing `f`, but `{f: {$ne: null}}`
            // does *not* — "not null" also means "present". server/highscores.js relies
            // on the first (see its test) and client/views/chat/chat.js on the second.
            return opVal === null ? !some((v) => v == null) : !some((v) => v === opVal);
          case '$exists':
            return some((v) => v !== undefined) === opVal;
          default:
            throw new Error(`FakeCollection: unsupported query operator "${op}"`);
        }
      });
    }
    // Mongo treats `{field: null}` as "null or missing", which is how
    // client/views/game/game_list.js selects the games that have no winner yet.
    if (cond === null) return some((v) => v == null);
    return some((v) => v === cond);
  });
}

// Mongo sort spec: { field: 1 | -1 }, applied left to right. Array.prototype.sort is
// stable, so equal keys keep insertion order — same as an unindexed Mongo sort in
// practice, and what the publication tests assert against.
function sortDocs(docs, spec) {
  const entries = Object.entries(spec);
  return [...docs].sort((a, b) => {
    for (const [field, dir] of entries) {
      const av = getPath(a, field);
      const bv = getPath(b, field);
      if (av === bv) continue;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return (av < bv ? -1 : 1) * (dir < 0 ? -1 : 1);
    }
    return 0;
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

// The only aggregation in the app is server/highscores.js, which uses exactly these
// four stages with a $sum and a $last accumulator. Anything else throws.
function aggregate(docs, pipeline) {
  let result = docs.map((d) => structuredClone(d));
  for (const stage of pipeline) {
    const [op, spec] = Object.entries(stage)[0];
    switch (op) {
      case '$match':
        result = result.filter((d) => matchesSelector(d, spec));
        break;
      case '$group': {
        const { _id: idSpec, ...accumulators } = spec;
        if (typeof idSpec !== 'string' || !idSpec.startsWith('$')) {
          throw new Error('FakeCollection: $group only supports a "$field" _id');
        }
        const idField = idSpec.slice(1);
        const groups = new Map();
        for (const doc of result) {
          const key = getPath(doc, idField) ?? null;
          const mapKey = JSON.stringify(key);
          if (!groups.has(mapKey)) groups.set(mapKey, { _id: key });
          const group = groups.get(mapKey);
          for (const [name, accSpec] of Object.entries(accumulators)) {
            const [accOp, accArg] = Object.entries(accSpec)[0];
            const argValue = (fallback) =>
              typeof accArg === 'string' && accArg.startsWith('$')
                ? (getPath(doc, accArg.slice(1)) ?? fallback)
                : accArg;
            switch (accOp) {
              case '$sum':
                group[name] = (group[name] || 0) + (argValue(0) || 0);
                break;
              // Documents arrive in insertion order, so the last one to be seen wins —
              // which is what Mongo does for an unsorted group. server/highscores.js uses
              // it only to carry a fallback label out of the group, so which member of the
              // group supplies it does not matter.
              case '$last':
                group[name] = argValue(undefined);
                break;
              default:
                throw new Error(`FakeCollection: unsupported accumulator "${accOp}"`);
            }
          }
        }
        result = [...groups.values()];
        break;
      }
      case '$sort':
        result = sortDocs(result, spec);
        break;
      case '$limit':
        result = result.slice(0, spec);
        break;
      default:
        throw new Error(`FakeCollection: unsupported aggregation stage "${op}"`);
    }
  }
  return result;
}

// Mongo field projection. Inclusion only, which is all the app asks for: the
// `onlineUsers` publication names the three fields it is willing to send, and the
// profile-name backfill in server/accounts.js asks for `emails` alone. An exclusion
// projection (`{field: 0}`) throws rather than being approximated — the point of the
// option here is that a test can prove a field did NOT go out, so a silently wrong
// projection would be worse than none.
function project(doc, fields) {
  const entries = Object.entries(fields).filter(([path]) => path !== '_id');
  if (entries.some(([, include]) => !include)) {
    throw new Error('FakeCollection: only inclusion projections are supported');
  }
  // Mongo includes _id unless it is explicitly excluded.
  const result = fields._id === 0 || fields._id === false ? {} : { _id: doc._id };
  for (const [path] of entries) {
    const value = getPath(doc, path);
    // Cloned like the unprojected path does: `doc` is the stored document, and a caller
    // holding a live reference into it could mutate the collection behind its own back.
    if (value !== undefined) setPath(result, path, structuredClone(value));
  }
  return result;
}

// `fields` is Meteor's spelling; `projection` (the raw driver's) is deliberately absent
// so that reaching for it fails loudly instead of being ignored.
const SUPPORTED_FIND_OPTIONS = ['sort', 'skip', 'limit', 'fields'];

class FakeCursor {
  constructor(docs, transform, fields) {
    this._docs = docs;
    this._transform = transform;
    this._fields = fields;
  }

  // Projection before transform, the order Mongo and Meteor apply them in: a transform
  // only ever sees the fields the projection let through.
  _snapshot() {
    return this._docs.map((d) => {
      const clone = this._fields ? project(d, this._fields) : structuredClone(d);
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
    this._allowRules = [];
    this._denyRules = [];
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

  find(selector, options = {}) {
    const unsupported = Object.keys(options).filter((k) => !SUPPORTED_FIND_OPTIONS.includes(k));
    if (unsupported.length) {
      throw new Error(`FakeCollection: unsupported find option(s) "${unsupported.join(', ')}"`);
    }
    let docs = this._rawMatches(selector);
    if (options.sort) docs = sortDocs(docs, options.sort);
    if (options.skip) docs = docs.slice(options.skip);
    if (options.limit != null) docs = docs.slice(0, options.limit);
    return new FakeCursor(docs, this._transform, options.fields);
  }

  // Delegates to find() so it inherits the same option validation and projection —
  // otherwise a `fields` option here would be silently ignored, which is the one thing
  // this fake is built not to do.
  findOne(selector, options = {}) {
    const [doc] = this.find(selector, { ...options, limit: 1 }).fetch();
    return doc;
  }

  findOneAsync(selector, options) {
    return Promise.resolve(this.findOne(selector, options));
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
    return Promise.resolve(this.remove(selector));
  }

  // Minimongo keeps the synchronous mutators on the client, and
  // client/views/game/game_page.js uses this one to cancel a game.
  remove(selector) {
    const matches = this._rawMatches(selector);
    for (const doc of matches) this._docs.delete(doc._id);
    return matches.length;
  }

  // Recorded rather than discarded: server/accounts.js's `Meteor.users.deny({update})` is
  // the only thing standing between a client and its own profile.name, and a rule that
  // silently vanished would be untestable. Registered at import time, so unlike the
  // documents these survive _reset().
  allow(rules) {
    this._allowRules.push(rules);
  }

  deny(rules) {
    this._denyRules.push(rules);
  }

  rawCollection() {
    const docs = () => [...this._docs.values()];
    return {
      aggregate(pipeline) {
        const result = aggregate(docs(), pipeline);
        return { toArray: () => Promise.resolve(result) };
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Server harness
// ---------------------------------------------------------------------------

const methodHandlers = new Map();
const publications = new Map();
const startupCallbacks = [];
let currentUserId = null;
let userSeq = 0;

function methodInvocation() {
  return {
    userId: currentUserId,
    connection: null,
    isSimulation: false,
    setUserId(id) {
      currentUserId = id;
    },
    unblock() {},
  };
}

export function resetFakeCollections() {
  for (const c of allFakeCollections) c._reset();
  currentUserId = null;
  userSeq = 0;
}

/**
 * Seat a user and make it the caller for subsequent Meteor.callAsync /
 * Meteor.userAsync() / Meteor.userId(). Accepts a user id or a partial user doc;
 * inserts it into Meteor.users if it isn't there yet. Returns the stored doc.
 */
export async function loginAs(user = {}) {
  const doc = typeof user === 'string' ? { _id: user } : { ...user };
  doc._id ??= `user_${++userSeq}`;
  doc.emails ??= [{ address: `${doc._id}@example.com`, verified: true }];
  doc.status ??= { online: true };
  if (!(await globalThis.Meteor.users.findOneAsync(doc._id))) {
    await globalThis.Meteor.users.insertAsync(doc);
  }
  currentUserId = doc._id;
  return globalThis.Meteor.users.findOneAsync(doc._id);
}

export function logout() {
  currentUserId = null;
}

/** Names of every method server/ registered — handy when a rename slips through. */
export function registeredMethods() {
  return [...methodHandlers.keys()].sort();
}

export function registeredPublications() {
  return [...publications.keys()].sort();
}

/** The allow/deny rules a collection was given at import time. */
export function collectionRules(collection) {
  return { allow: collection._allowRules, deny: collection._denyRules };
}

/**
 * Invoke a publication the way the DDP layer does, with `this.userId` bound to the
 * current login. Returns whatever the handler returns (a cursor, or a promise of one
 * for the async publications).
 */
export async function runPublication(name, context = {}, ...args) {
  const handler = publications.get(name);
  if (!handler) throw new Error(`FakeMeteor: no publication named "${name}"`);
  const ctx = {
    userId: currentUserId,
    ready() {},
    stop() {},
    onStop() {},
    added() {},
    changed() {},
    removed() {},
    ...context,
  };
  return handler.apply(ctx, args);
}

/** Run the Meteor.startup callbacks server/ registered, in registration order. */
export async function runStartup() {
  for (const fn of startupCallbacks) await fn();
}

// Captures what server/cron.js configures inside Meteor.startup. `verificationEmails`
// records userIds passed to Accounts.sendVerificationEmail.
const accountsState = {
  validateNewUser: [],
  validateLoginAttempt: [],
  onCreateUser: [],
  verificationEmails: [],
};

export function accountsHooks() {
  return accountsState;
}

export function resetAccounts() {
  accountsState.validateNewUser.length = 0;
  accountsState.validateLoginAttempt.length = 0;
  accountsState.onCreateUser.length = 0;
  accountsState.verificationEmails.length = 0;
  globalThis.Accounts._options = {};
  globalThis.Accounts.emailTemplates = {};
}

/**
 * Replace Meteor.settings wholesale. Call before runStartup() — server/cron.js reads
 * VERIFY_EMAILS / MAIL_FROM / ALLOWED_* inside its startup block, not at import time.
 */
export function setSettings(settings = {}) {
  globalThis.Meteor.settings = { public: {}, ...settings };
}

globalThis.Meteor = {
  Collection: FakeCollection,
  isServer: true,
  isClient: false,
  isProduction: false,
  isDevelopment: true,
  settings: { public: {} },
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (h) => clearInterval(h),
  methods(defs) {
    for (const [name, fn] of Object.entries(defs)) methodHandlers.set(name, fn);
  },
  publish(name, fn) {
    publications.set(name, fn);
  },
  startup(fn) {
    startupCallbacks.push(fn);
  },
  callAsync(name, ...args) {
    const handler = methodHandlers.get(name);
    if (!handler) {
      return Promise.reject(new Error(`FakeMeteor: no method registered named "${name}"`));
    }
    return Promise.resolve().then(() => handler.apply(methodInvocation(), args));
  },
  userId: () => currentUserId,
  // Guard the null case explicitly: FakeCollection treats a null selector as
  // "match everything", so findOneAsync(null) would hand back an arbitrary user.
  user: () => (currentUserId ? globalThis.Meteor.users.findOne(currentUserId) : undefined),
  userAsync: () =>
    currentUserId
      ? globalThis.Meteor.users.findOneAsync(currentUserId)
      : Promise.resolve(undefined),
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

globalThis.Accounts = {
  _options: {},
  emailTemplates: {},
  config(options) {
    Object.assign(globalThis.Accounts._options, options);
  },
  validateNewUser(fn) {
    accountsState.validateNewUser.push(fn);
  },
  validateLoginAttempt(fn) {
    accountsState.validateLoginAttempt.push(fn);
  },
  // Real Meteor throws on a second registration; the harness re-runs startup once per
  // test, so it collects instead — accountsHooks().onCreateUser is expected to hold
  // exactly one entry after a single runStartup().
  onCreateUser(fn) {
    accountsState.onCreateUser.push(fn);
  },
  sendVerificationEmail(userId) {
    accountsState.verificationEmails.push(userId);
  },
};

globalThis.Random = { id: () => 'rnd' + Math.random().toString(36).slice(2, 9) };

// Board/Area construction logs to stdout on every build ("Load risky_exchange board",
// "Start 5,3,up", "Checkpoint 1 located at 7,1", ...), and the server methods and cron
// jobs narrate every step. both/logging.js only silences this in production and isn't
// part of the import graph under test, so silence it here instead of flipping
// Meteor.isProduction (which would change what the code under test does).
// console.error stays live, and deliberately so. both/logging.js silences only
// console.log in production, which makes warn/error the channels that actually reach a
// production log — so error is a real signal, not decoration. Two sites use it
// (both/cardlogic.js: the exhausted-hand branch and the auto-submit timer's catch), and
// several tests legitimately drive them.
//
// Keeping the run quiet is the reporter's job, not this file's: `silent: 'passed-only'`
// in vitest.config.mjs drops console output from passing tests and keeps every line a
// failing test produced. Silencing console.error here instead would throw that diagnostic
// away exactly when it is needed.
console.log = () => {};
console.info = () => {};
console.debug = () => {};
console.warn = () => {};
