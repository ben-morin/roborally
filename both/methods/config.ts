import { Methods } from 'meteor/jam:method';

// Package-wide settings for jam:method. Every method lives in a sibling module here, and
// each one starts with `import './config.ts'` — that import is the load-order rule, not
// tidiness.
//
// The reason: `createMethod` reads `serverOnly` and `open` when it *runs*, in its module
// body, and keeps what it read. `loggedOutError` and the global before/after hooks are
// read per call instead. So a method module that loaded ahead of this one would keep the
// package defaults — simulating in the browser, and throwing the package's own
// `'logged-out'` string error — for the life of the process, and only for itself. Both
// entry points also import this module high up, next to `both/easySchemaConfig.ts`, which
// has the same rule for the same reason.
//
// It has to load on the CLIENT as well. A simulated method's stub runs the logged-in check
// itself, against the client's copy of this configuration; with only the server configured,
// an anonymous call to a card method throws the package's `'logged-out'` from the stub and
// never reaches the server at all (`throwStubExceptions` is on by default).
Methods.configure({
  // Simulate only where a method asks for it. The package default is the opposite, which
  // would put `createGame`, `joinGame` and friends to work in minimongo — a behaviour
  // change nothing here wants. `serverOnly: false` is opt-in, and today only the three
  // card-selection methods take it: their whole point is that a register slot fills before
  // the round trip.
  serverOnly: true,
  // The package's own is `new Meteor.Error('logged-out', …)`, a string code. Every call
  // site in the app shows `error.reason` and the rest of the app speaks numeric codes, so
  // this is the same 401 the twelve deleted `if (!user) throw …` preambles threw. One
  // message for all of them: a single error instance cannot vary per method, and nothing
  // reads the reason but a modal.
  loggedOutError: new Meteor.Error(401, 'You need to login'),
});
