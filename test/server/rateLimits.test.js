// DDPRateLimiter throttles DDP messages, which the harness has none of — so what is worth
// pinning is that the rules exist with the right numbers, that each one names a method
// that still exists (the limiter matches on the method name as a string, so a rename
// silently unlimits it), and how the buckets are keyed.
//
// The rules used to live in one server-side table that this test imported and read back,
// so it could not disagree with them. They are now a `rateLimit:` line on four
// `createMethod` definitions in three files, so the numbers below are a literal instead:
// this test is what stops one drifting where nothing else would notice.
import { describe, expect, it } from 'vitest';
import '../helpers/server.js';
import { registeredRateLimits } from 'meteor/ddp-rate-limiter';
import { registeredMethods } from '../setup.js';

// Sized against what a player can legitimately do. `playCards` is once per turn plus the
// occasional retry after a reconnect; `createGame`/`joinGame` are deliberate clicks;
// `addMessage` is typing. Meteor rate-limits its own login and account methods and leaves
// the rest to the app, so these four — the three that insert documents and the one that
// drives the phase machine — are the ones a client could otherwise drive in a loop.
const RATE_LIMITS = [
  { name: 'addMessage', requests: 5, intervalMs: 5000 },
  { name: 'createGame', requests: 3, intervalMs: 10000 },
  { name: 'joinGame', requests: 5, intervalMs: 10000 },
  { name: 'playCards', requests: 5, intervalMs: 5000 },
];

describe('method rate limits', () => {
  it('registers one rule per entry in the table, with its numbers', () => {
    expect(registeredRateLimits()).toHaveLength(RATE_LIMITS.length);

    for (const { name, requests, intervalMs } of RATE_LIMITS) {
      const rule = registeredRateLimits().find((r) => r.matcher.name === name);
      expect(rule).toBeDefined();
      expect(rule.numRequests).toBe(requests);
      expect(rule.intervalMs).toBe(intervalMs);
    }
  });

  it('covers every method a client can drive in a loop', () => {
    expect(
      registeredRateLimits()
        .map((r) => r.matcher.name)
        .sort()
    ).toEqual(['addMessage', 'createGame', 'joinGame', 'playCards']);
  });

  it('limits methods that actually exist', () => {
    const methods = registeredMethods();

    for (const { name } of RATE_LIMITS) {
      expect(methods).toContain(name);
    }
  });

  // No two connections ever share a bucket. The limiter keys a bucket on the values of
  // every matcher field, and jam:method's rule matches on address, connection *and* user,
  // so the bucket is at least as fine as the per-connection rule this replaced. That
  // fineness is the point: all four methods are reachable before their login check
  // throws, and a bucket keyed on `userId` alone would file every logged-out caller into
  // one shared bucket — a denial of service against sign-up rather than a rate limit.
  // The price is that an anonymous flood still costs the attacker a new DDP connection
  // per bucket, which is the same price as before.
  it('buckets per connection, address and user', () => {
    for (const rule of registeredRateLimits()) {
      expect(rule.matcher.type).toBe('method');
      expect(rule.matcher.clientAddress('anything')).toBe(true);
      expect(rule.matcher.connectionId('anything')).toBe(true);
      expect(rule.matcher.userId('anything')).toBe(true);
    }
  });
});
