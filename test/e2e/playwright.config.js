import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;

// Every relative path below resolves against this file's directory (test/e2e/), so the
// spec, the settings file and both report folders stay in one place and nothing lands at
// the repo root. Playwright only auto-discovers a config in the directory it is launched
// from, which is why the package.json scripts pass `-c test/e2e/playwright.config.js`.
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  // The play phase is paced by server-side sleeps (see both/gamestate.js): one register is
  // 6–7 s of wall clock, so the default 5 s expect timeout is too tight for the assertions
  // that wait on it.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // One server, one game — nothing here is worth parallelising.
  workers: 1,
  // A retry in CI shows up as "flaky" in the report, so it cannot hide a real failure.
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI
    ? [['github'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: './playwright-report' }]],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // `meteor` would find the project by walking up to `.meteor/`, but be explicit: run
    // from the repo root so the settings path reads the same as it does in the scripts.
    cwd: '../..',
    command: 'meteor run --settings test/e2e/settings.json',
    url: 'http://localhost:3000',
    // A cold `meteor run` in CI downloads Atmosphere packages and then does a cold Rspack
    // build before it answers; locally the build cache makes it far quicker.
    timeout: CI ? 600_000 : 180_000,
    // Locally, reuse a server that is already up — start it with the same settings file
    // (`meteor run --settings test/e2e/settings.json`), NOT `meteor npm run dev`: that
    // settings file has an email allowlist, and the sign-up step would get a 403.
    reuseExistingServer: !CI,
    stdout: CI ? 'pipe' : 'ignore',
    stderr: 'pipe',
  },
});
