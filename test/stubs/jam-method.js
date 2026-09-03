// Resolves `meteor/jam:method` for the method modules under both/methods/.
//
// Unlike test/stubs/jam-easy-schema.js this is deliberately NOT a pass-through. Everything
// the real package puts between a caller and a method body is routing — the logged-in
// check, the validator, the before/after pipeline, the rate-limit rule — and that routing
// is exactly what test/server/methods.test.js exists to drive. So this mirrors method.js
// (jam:method 1.9.1) wherever the order or the timing of it is observable, and nothing
// else.
//
// Mirrored, and why each one matters:
//
//   - The order inside a call: logged-in check FIRST, then validation, then global
//     `before` -> method `before` -> `run` -> method `after` -> global `after`. An
//     anonymous call with malformed arguments therefore gets the logged-out error, not a
//     400.
//   - `open` and `serverOnly` are read at DEFINITION time; `loggedOutError` and the global
//     `before`/`after` per call. That split is the reason every both/methods/*.js starts
//     with `import './config.js'` — a method defined before the configure call would keep
//     the package defaults forever, and only for itself.
//   - Pipeline threading: a `before` result is discarded and the validated input flows on;
//     `run`'s result is what `after` receives and what the call returns.
//
// Not mirrored, and reaching for any of it throws rather than quietly doing nothing:
// `.pipe`, the functional `createMethod(fn)` form, `attachMethods` and the
// `Mongo.Collection` wrapper, and jam:offline. Nor is the client half: `serverOnly`
// decides whether a *stub* is registered in the browser, and out here `Meteor.isServer` is
// always true, so every method lands in the harness registry and `registeredMethods()`
// lists all of them. `call.serverOnly` and `simulatedMethods()` are how a test reads that
// decision instead.
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';

// The package's own defaults, so a test reading methodsConfig() sees what the app changed
// against what it inherited.
const config = {
  before: [],
  after: [],
  serverOnly: false,
  open: false,
  loggedOutError: new globalThis.Meteor.Error('logged-out', 'You must be logged in'),
};

// Every key the package accepts, so a misspelled one fails here rather than sitting in a
// definition doing nothing. `options` (returnStubValue / throwStubExceptions) is the one
// that is accepted and then ignored: it only ever reaches Meteor.applyAsync on the client,
// which the harness has none of.
const CONFIGURE_KEYS = ['before', 'after', 'serverOnly', 'open', 'loggedOutError', 'options'];
const DEFINITION_KEYS = [
  'name',
  'schema',
  'validate',
  'before',
  'after',
  'run',
  'rateLimit',
  'open',
  'serverOnly',
  'options',
];

const unknownKeys = (object, allowed) => Object.keys(object).filter((k) => !allowed.includes(k));

const asArray = (value) => (Array.isArray(value) ? value : [value]);

const simulated = [];

/**
 * Register a method. Same signature as the package's object form; see the header for what
 * is mirrored.
 */
export function createMethod(definition) {
  if (typeof definition === 'function') {
    throw new Error('jam-method stub: the functional createMethod(fn) form is not supported');
  }

  const unknown = unknownKeys(definition, DEFINITION_KEYS);
  if (unknown.length) {
    throw new Error(`jam-method stub: unknown createMethod key(s) "${unknown.join(', ')}"`);
  }

  const {
    name,
    schema,
    validate,
    before = [],
    after = [],
    run,
    rateLimit,
    open,
    serverOnly,
  } = definition;

  if (!name) {
    throw new Error('jam-method stub: you must pass in a name when creating a method');
  }
  if (typeof run !== 'function') {
    throw new Error(
      `jam-method stub: method "${name}" needs a run function (.pipe is not supported)`
    );
  }
  // The package rejects both together at definition time, and rejects neither when `run`
  // takes an argument — a method whose body reads nothing needs no validator.
  if (schema && validate) {
    throw new Error(`jam-method stub: method "${name}" passes a schema and a validate function`);
  }
  if (!schema && !validate && run.length !== 0) {
    throw new Error(`jam-method stub: method "${name}" takes an argument but validates nothing`);
  }

  // Definition time, like the package: a later Methods.configure cannot reach these two.
  const checkLoggedIn = !(open ?? config.open);
  const isServerOnly = serverOnly ?? config.serverOnly;
  if (!isServerOnly) simulated.push(name);

  async function handler(data) {
    // Read per call, unlike the two above.
    if (checkLoggedIn && !this.userId) throw config.loggedOutError;

    // A `schema` is a pass-through for the same reason test/stubs/jam-easy-schema.js
    // validates nothing: the real validator needs a Meteor build and a live MongoDB, and
    // is exercised in the browser by test/e2e/. Every method here passes `validate`
    // instead — see the header of both/schemas/methods.js for why.
    if (validate) await validate.call(this, data);

    const onResult = [];
    const onError = [];
    const context = {
      originalInput: data,
      type: 'method',
      name,
      onResult(callback) {
        onResult.push(callback);
      },
      onError(callback) {
        onError.push(callback);
      },
    };

    try {
      for (const fn of [...asArray(config.before), ...asArray(before)]) {
        await fn.call(this, data, context);
      }
      const result = await run.call(this, data, context);
      for (const fn of [...asArray(after), ...asArray(config.after)]) {
        await fn.call(this, result, context);
      }
      for (const callback of onResult) callback(result);
      return result;
    } catch (error) {
      throw onError.reduce((err, callback) => callback(err) ?? err, error);
    }
  }

  // The harness registry, so registeredMethods() and its Meteor.callAsync keep working
  // exactly as they did for the Meteor.methods({...}) block this replaces.
  globalThis.Meteor.methods({ [name]: handler });

  if (rateLimit) {
    DDPRateLimiter.addRule(
      {
        type: 'method',
        name,
        clientAddress: () => true,
        connectionId: () => true,
        userId: () => true,
      },
      rateLimit.limit,
      rateLimit.interval
    );
  }

  // `Meteor.callAsync` is looked up inside the body, never captured at import: the client
  // tests intercept with `vi.spyOn(Meteor, 'callAsync')`, and a captured reference would
  // miss every call.
  const call = (...args) => globalThis.Meteor.callAsync(name, ...args);

  call.call = (context, data) => handler.apply(context, [data]);
  call.validate = (data) => validate?.(data);
  call.serverOnly = isServerOnly;

  return call;
}

export const Methods = Object.freeze({
  config,
  configure(options) {
    const unknown = unknownKeys(options, CONFIGURE_KEYS);
    if (unknown.length) {
      throw new Error(`jam-method stub: unknown Methods.configure key(s) "${unknown.join(', ')}"`);
    }
    // The package type-checks this one, and a plain object here would be thrown as-is and
    // reach the client as a 500 rather than the app's 401.
    if (options.loggedOutError && !(options.loggedOutError instanceof Error)) {
      throw new Error('jam-method stub: loggedOutError must be an Error instance');
    }
    return Object.assign(config, options);
  },
  create: createMethod,
});

/** The package defaults with whatever the app's Methods.configure merged in. */
export function methodsConfig() {
  return config;
}

/** Names whose `serverOnly` resolved false — the methods that simulate in the browser. */
export function simulatedMethods() {
  return [...simulated].sort();
}
