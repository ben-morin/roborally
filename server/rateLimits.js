// Meteor rate-limits its own login and account methods out of the box and leaves the
// rest to the app ("it's up to you to define rate limits for your other Methods" — the
// Meteor guide). These are the four methods a client can drive in a loop: three that
// insert documents and one that drives the phase machine.
//
// Buckets are per connection rather than per user, so an anonymous flood — every one of
// these methods is reachable before the login check throws — costs the attacker a new
// DDP connection per bucket instead of sharing one `userId: null` bucket with every
// other logged-out visitor.
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';

// Sized against what a player can legitimately do. `playCards` is once per turn plus the
// occasional retry after a reconnect; `createGame`/`joinGame` are deliberate clicks;
// `addMessage` is typing. Exported so the test can assert the registrations match.
export const RATE_LIMITS = [
  { name: 'addMessage', requests: 5, intervalMs: 5000 },
  { name: 'createGame', requests: 3, intervalMs: 10000 },
  { name: 'joinGame', requests: 5, intervalMs: 10000 },
  { name: 'playCards', requests: 5, intervalMs: 5000 },
];

for (const { name, requests, intervalMs } of RATE_LIMITS) {
  DDPRateLimiter.addRule({ type: 'method', name, connectionId: () => true }, requests, intervalMs);
}
