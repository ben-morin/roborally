import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const stub = (file) => fileURLToPath(new URL(`./test/stubs/${file}`, import.meta.url));

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
  plugins: [blazeHtmlStub],
  // The `meteor/...` specifiers the app reaches, plus `bootstrap`, whose real bundle
  // touches `document` as it loads. Anchored regexes rather than plain string keys so a
  // new `meteor/...` import fails to resolve loudly instead of silently picking up a
  // stub meant for something else.
  resolve: {
    alias: [
      { find: /^meteor\/meteor$/, replacement: stub('meteor-meteor.js') },
      { find: /^meteor\/mongo$/, replacement: stub('meteor-mongo.js') },
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
  },
});
