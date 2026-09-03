const globals = require('globals');
const prettier = require('eslint-config-prettier/flat');
const tseslint = require('typescript-eslint');

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
      'test/e2e/playwright-report/**',
      'test/e2e/test-results/**',
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
      // Stricter than the 'smart' option this replaced: `==` is an error everywhere except
      // against `null`, where it is the intended "null or undefined" test. Every remaining
      // `== null` in the tree is one of those; `'smart'` additionally tolerated literal and
      // typeof comparisons, which nothing needs.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // TypeScript files. The compiler owns undefined names and unused bindings, so the two
  // core rules step aside for their typescript-eslint counterparts. `recommended`, not
  // `recommendedTypeChecked`: the type-aware set builds a full tsc program on every lint,
  // and `npm run typecheck` already is that run.
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.ts'] })),
  {
    files: ['**/*.ts'],
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // `interface Game extends GameDoc {}` is how a collection's transform type gets its
      // document fields — see collections/games.ts.
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
    },
  },
  {
    files: ['collections/**/*.ts'],
    rules: {
      // The transform pattern merges an interface (the document's fields) into a class
      // (the methods), and `Object.create(Game.prototype)` joins them at runtime. That is
      // precisely the merge this rule exists to flag, and here it is the design.
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    },
  },
  prettier,
];
