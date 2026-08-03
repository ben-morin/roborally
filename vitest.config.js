import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const stub = (file) => fileURLToPath(new URL(`./test/stubs/${file}`, import.meta.url));

export default defineConfig({
  // The only `meteor/...` specifiers the server reaches. Anchored regexes rather than
  // plain string keys so a new `meteor/...` import fails to resolve loudly instead of
  // silently picking up a stub meant for something else.
  resolve: {
    alias: [
      { find: /^meteor\/meteor$/, replacement: stub('meteor-meteor.js') },
      { find: /^meteor\/mongo$/, replacement: stub('meteor-mongo.js') },
      { find: /^meteor\/quave:synced-cron$/, replacement: stub('synced-cron.js') },
    ],
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
  },
});
