import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// both/logging.ts does its work in its module body, so every case re-imports it against
// a fresh module registry. `marker` stands in for the real console.log: the assertion
// is whether the module left it alone or replaced it with a no-op.
const marker = () => {};
const original = { log: console.log, isServer: Meteor.isServer, isProduction: Meteor.isProduction };

async function loadWith({ isServer, isProduction, debugLog }) {
  Meteor.isServer = isServer;
  Meteor.isProduction = isProduction;
  if (debugLog === undefined) delete process.env.DEBUG_LOG;
  else process.env.DEBUG_LOG = debugLog;
  console.log = marker;
  vi.resetModules();
  await import('../../both/logging.ts');
  return console.log === marker;
}

beforeEach(() => {
  delete process.env.DEBUG_LOG;
});

afterEach(() => {
  console.log = original.log;
  Meteor.isServer = original.isServer;
  Meteor.isProduction = original.isProduction;
  delete process.env.DEBUG_LOG;
});

describe('both/logging.ts', () => {
  it('leaves console.log alone in development', async () => {
    expect(await loadWith({ isServer: true, isProduction: false })).toBe(true);
  });

  it('silences console.log in production when DEBUG_LOG is absent', async () => {
    expect(process.env.DEBUG_LOG).toBeUndefined();
    expect(await loadWith({ isServer: true, isProduction: true })).toBe(false);
  });

  it('keeps console.log in production when DEBUG_LOG=true', async () => {
    expect(await loadWith({ isServer: true, isProduction: true, debugLog: 'true' })).toBe(true);
  });

  it('only accepts the exact value true', async () => {
    expect(await loadWith({ isServer: true, isProduction: true, debugLog: '1' })).toBe(false);
  });

  it('keeps the client silent in production whatever the server environment says', async () => {
    expect(await loadWith({ isServer: false, isProduction: true, debugLog: 'true' })).toBe(false);
  });
});
