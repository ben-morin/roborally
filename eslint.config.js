const globals = require('globals');
const prettier = require('eslint-config-prettier/flat');

// Meteor framework globals (would come from eslint-plugin-meteor's env in
// legacy config; declared here for flat config).
const meteorGlobals = {
  Meteor: 'readonly',
  Mongo: 'readonly',
  Accounts: 'readonly',
  Template: 'readonly',
  Tracker: 'readonly',
  Blaze: 'readonly',
  Session: 'readonly',
  ReactiveDict: 'readonly',
  ReactiveVar: 'readonly',
  Random: 'readonly',
  EJSON: 'readonly',
  WebApp: 'readonly',
  Package: 'readonly',
  check: 'readonly',
  Match: 'readonly',
  Roles: 'readonly',
  SyncedCron: 'readonly',
  _: 'readonly',
  // Bootstrap 5 (loaded as a global via public/bootstrap.bundle.min.js)
  bootstrap: 'readonly',
};

// Project-defined globals — declared `writable` because these names are
// assigned at module top level (e.g. `GameLogic = {...}`) as well as read.
const projectGlobals = {
  // Collections (collections/)
  Games: 'writable',
  Players: 'writable',
  Cards: 'writable',
  Chat: 'writable',
  Deck: 'writable',
  Highscores: 'writable',
  // Game model / logic (both/)
  GameState: 'writable',
  GameLogic: 'writable',
  CardLogic: 'writable',
  Board: 'writable',
  BoardBox: 'writable',
  Tile: 'writable',
  Area: 'writable',
  // Routing
  FlowRouter: 'writable',
  // Project helpers / shared utilities defined as implicit globals
  modalAlert: 'writable',
  modalConfirm: 'writable',
  animatePosition: 'writable',
  animateRotation: 'writable',
  cssPosition: 'writable',
  getUsername: 'writable',
  ownsDocument: 'writable',
  shuffle: 'writable',
  buildHighscores: 'writable',
};

module.exports = [
  {
    ignores: [
      '.meteor/**',
      'node_modules/**',
      'packages/meteor-accounts-ui-roborally/**',
      'public/**',
      '_build/**',
      '**/*.coffee',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jquery,
        ...meteorGlobals,
        ...projectGlobals,
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['warn', 'smart'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
];
