// DDPRateLimiter throttles DDP messages, which the harness has none of — so what is
// worth pinning is that the rules exist, that each one names a method that still exists
// (the limiter matches on the method name as a string, so a rename silently unlimits it),
// and that they are bucketed per connection rather than per user.
import { describe, expect, it } from 'vitest';
import '../helpers/server.js';
import { registeredRateLimits } from 'meteor/ddp-rate-limiter';
import { RATE_LIMITS } from '../../server/rateLimits.js';
import { registeredMethods } from '../setup.js';

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
    expect(RATE_LIMITS.map((r) => r.name).sort()).toEqual([
      'addMessage',
      'createGame',
      'joinGame',
      'playCards',
    ]);
  });

  it('limits methods that actually exist', () => {
    const methods = registeredMethods();

    for (const { name } of RATE_LIMITS) {
      expect(methods).toContain(name);
    }
  });

  // Per connection, not per user: all four methods are reachable before their login check
  // throws, and a `userId` matcher would file every logged-out caller into one shared
  // bucket — which is a denial of service against sign-up rather than a rate limit.
  it('buckets per connection', () => {
    for (const rule of registeredRateLimits()) {
      expect(rule.matcher.type).toBe('method');
      expect(rule.matcher.connectionId('anything')).toBe(true);
      expect(rule.matcher.userId).toBeUndefined();
    }
  });
});
