// Second vitest setupFile: the Blaze-side globals the client view modules expect.
//
// Blaze templates are compiled by Meteor's build, so they cannot be rendered outside a
// Meteor app. What *can* be tested is everything a template calls: `Template.foo.helpers`
// is a plain registry of functions, each invoked with the data context as `this`. This
// shim captures those registrations instead of rendering them, so a test can call a
// helper directly with a real transform-wrapped document from FakeCollection and assert
// on the property bag it returns.
//
// Client tests opt into a DOM with a `// @vitest-environment jsdom` docblock; nothing
// here touches `document` at install time, so the server tests keep running under node.
//
// The reactivity shims are deliberately inert: ReactiveDict/ReactiveVar store and return
// values without invalidating anything, Tracker.autorun runs its body once, and
// Tracker.afterFlush queues its callback for flushTracker() rather than firing it. That
// keeps a helper call a plain function call — helpers that schedule DOM work as a side
// effect (board.js's laser and robot animations) return their value without needing a
// render loop, and a test that wants the deferred work can ask for it.

const templates = {};
const globalHelpers = {};
const afterFlushQueue = [];
const allReactiveDicts = [];

const TEMPLATE_API = new Set(['registerHelper', 'instance', 'currentData', '__templates']);

function makeTemplate(name) {
  const template = {
    viewName: `Template.${name}`,
    __name: name,
    __helpers: {},
    __events: {},
    __onCreated: [],
    __onRendered: [],
    __onDestroyed: [],
    helpers(defs) {
      Object.assign(template.__helpers, defs);
    },
    events(defs) {
      Object.assign(template.__events, defs);
    },
    onCreated(fn) {
      template.__onCreated.push(fn);
    },
    onRendered(fn) {
      template.__onRendered.push(fn);
    },
    onDestroyed(fn) {
      template.__onDestroyed.push(fn);
    },
  };
  return template;
}

let currentData = {};

// A Proxy so `Template.whatever.helpers({...})` works for any template name without the
// harness having to know the list up front.
globalThis.Template = new Proxy(
  {},
  {
    get(target, prop) {
      if (typeof prop !== 'string' || TEMPLATE_API.has(prop)) {
        switch (prop) {
          case 'registerHelper':
            return (name, fn) => {
              globalHelpers[name] = fn;
            };
          case 'currentData':
            return () => currentData;
          case 'instance':
            return () => undefined;
          case '__templates':
            return templates;
          default:
            return target[prop];
        }
      }
      templates[prop] ??= makeTemplate(prop);
      return templates[prop];
    },
    has() {
      return true;
    },
  }
);

class ReactiveDict {
  constructor(initial = {}) {
    this._data = { ...initial };
    allReactiveDicts.push(this);
  }
  get(key) {
    return this._data[key];
  }
  set(key, value) {
    this._data[key] = value;
  }
  equals(key, value) {
    return this._data[key] === value;
  }
  clear() {
    this._data = {};
  }
}

class ReactiveVar {
  constructor(value) {
    this._value = value;
  }
  get() {
    return this._value;
  }
  set(value) {
    this._value = value;
  }
}

globalThis.ReactiveDict = ReactiveDict;
globalThis.ReactiveVar = ReactiveVar;

globalThis.Tracker = {
  Dependency: class {
    depend() {}
    changed() {}
  },
  autorun(fn) {
    const computation = { stop() {}, firstRun: true, invalidate() {} };
    fn(computation);
    return computation;
  },
  afterFlush(fn) {
    afterFlushQueue.push(fn);
  },
  nonreactive: (fn) => fn(),
  flush() {},
};

globalThis.Blaze = { toHTML: () => '' };

/**
 * A registered helper, as a plain function. Throws rather than returning undefined so a
 * renamed or unregistered helper fails loudly instead of as "not a function".
 */
export function templateHelper(templateName, helperName) {
  const template = templates[templateName];
  if (!template) {
    throw new Error(
      `No template "${templateName}" registered. Did the test import its view module? ` +
        `Registered: ${Object.keys(templates).join(', ') || '(none)'}`
    );
  }
  const helper = template.__helpers[helperName];
  if (!helper) {
    throw new Error(
      `Template.${templateName} has no helper "${helperName}". ` +
        `Registered: ${Object.keys(template.__helpers).join(', ') || '(none)'}`
    );
  }
  return helper;
}

/** Invoke a helper with `data` as its `this`, the way Blaze calls it. */
export function callHelper(templateName, helperName, data = {}, ...args) {
  return templateHelper(templateName, helperName).apply(data, args);
}

/** An event handler, keyed exactly as registered, e.g. 'click .available'. */
export function templateEvent(templateName, key) {
  const template = templates[templateName];
  if (!template) throw new Error(`No template "${templateName}" registered`);
  const handler = template.__events[key];
  if (!handler) {
    throw new Error(
      `Template.${templateName} has no event "${key}". ` +
        `Registered: ${Object.keys(template.__events).join(', ') || '(none)'}`
    );
  }
  return handler;
}

/** A helper registered globally via Template.registerHelper (client/helper/datehelper.js). */
export function globalHelper(name) {
  const helper = globalHelpers[name];
  if (!helper) {
    throw new Error(
      `No global helper "${name}". Registered: ${Object.keys(globalHelpers).join(', ') || '(none)'}`
    );
  }
  return helper;
}

export function templateLifecycle(templateName) {
  const template = templates[templateName];
  if (!template) throw new Error(`No template "${templateName}" registered`);
  return {
    onCreated: template.__onCreated,
    onRendered: template.__onRendered,
    onDestroyed: template.__onDestroyed,
  };
}

/** Run and clear whatever the helpers queued through Tracker.afterFlush. */
export function flushTracker() {
  const queued = afterFlushQueue.splice(0, afterFlushQueue.length);
  for (const fn of queued) fn();
  return queued.length;
}

export function pendingAfterFlush() {
  return afterFlushQueue.length;
}

export function setCurrentData(data) {
  currentData = data;
}

/**
 * Reset the per-test client state: route, queued Tracker work, and every ReactiveDict
 * the view modules created at module scope (cards.js keeps its selected slot in one, so
 * without this a click in one test leaks into the next).
 */
export function resetClientState() {
  afterFlushQueue.length = 0;
  currentData = {};
  for (const dict of allReactiveDicts) dict.clear();
}
