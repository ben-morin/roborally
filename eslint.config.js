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
  ReactiveDict: 'readonly',
  ReactiveVar: 'readonly',
  Random: 'readonly',
  EJSON: 'readonly',
  WebApp: 'readonly',
  Package: 'readonly',
  check: 'readonly',
  Match: 'readonly',
  Roles: 'readonly',
  _: 'readonly',
  // Bootstrap 5 (loaded as a global via public/bootstrap.bundle.min.js)
  bootstrap: 'readonly',
};

// There is deliberately no `projectGlobals` list any more. Every app symbol is an
// ES module export as of Milestone 2, so `no-undef` below is what keeps it that way —
// a reintroduced implicit global is now a lint error rather than something that only
// shows up as a runtime `ReferenceError` under module strict mode.

module.exports = [
  {
    ignores: [
      '.meteor/**',
      'node_modules/**',
      'packages/meteor-accounts-ui-roborally/**',
      'public/**',
      '_build/**',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...meteorGlobals,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['warn', 'smart'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
];
