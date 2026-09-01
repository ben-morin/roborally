import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// This file lives in test/, beside the suite it configures, so vitest has to be told where
// it is (`--config test/vitest.config.mjs` in the package.json scripts) and where the
// project is: `root` would otherwise default to whatever directory vitest was launched
// from, and `include` and `setupFiles` below are resolved against it.
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const stub = (file) => fileURLToPath(new URL(`./stubs/${file}`, import.meta.url));

// Blaze templates are compiled by Meteor's build, so `import './cards.html'` has nothing
// to resolve to out here. The view modules import them purely for the side effect of
// registering the template, and the helper tests never render, so resolve them to an
// empty module rather than teaching vitest about Spacebars.
const blazeHtmlStub = {
  name: 'blaze-html-stub',
  enforce: 'pre',
  resolveId(id) {
    if (id.endsWith('.html')) return '\0blaze-html-stub';
    return null;
  },
  load(id) {
    if (id === '\0blaze-html-stub') return 'export default {};';
    return null;
  },
};

export default defineConfig({
  root: projectRoot,
  plugins: [blazeHtmlStub],
  // The `meteor/...` specifiers the app reaches, plus `bootstrap`, whose real bundle
  // touches `document` as it loads. Anchored regexes rather than plain string keys so a
  // new `meteor/...` import fails to resolve loudly instead of silently picking up a
  // stub meant for something else.
  resolve: {
    alias: [
      { find: /^meteor\/mongo$/, replacement: stub('meteor-mongo.js') },
      { find: /^meteor\/check$/, replacement: stub('meteor-check.js') },
      { find: /^meteor\/jam:easy-schema$/, replacement: stub('jam-easy-schema.js') },
      { find: /^meteor\/ddp-rate-limiter$/, replacement: stub('ddp-rate-limiter.js') },
      { find: /^meteor\/quave:synced-cron$/, replacement: stub('synced-cron.js') },
      { find: /^meteor\/ostrio:flow-router-extra$/, replacement: stub('flow-router.js') },
      { find: /^bootstrap$/, replacement: stub('bootstrap.js') },
    ],
  },
  test: {
    // Default node; the client tests opt into a DOM per file with
    // `// @vitest-environment jsdom`, so the server suite stays as fast as it was.
    environment: 'node',
    setupFiles: ['./test/setup.js', './test/clientSetup.js'],
    include: ['test/**/*.test.js'],
    // The Playwright suite shares the folder. Its files are *.spec.js, which `include`
    // would never match anyway — this writes the boundary down. Setting `exclude`
    // replaces vitest's defaults (node_modules and friends), hence the spread.
    exclude: [...configDefaults.exclude, 'test/e2e/**'],
    // A passing test should say nothing. `both/logging.js` silences only console.log in
    // production, so console.error stays live in the harness (see test/setup.js) — and
    // several tests legitimately drive code that calls it, e.g. the exhausted-hand branch
    // in both/cardlogic.js. Suppressing that for green tests keeps the run readable;
    // 'passed-only' still prints everything a *failing* test logged, which is the moment
    // the output is actually worth reading.
    silent: 'passed-only',
  },
});
