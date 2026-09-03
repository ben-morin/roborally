// test/stubs/jam-method.js is the only importer: a `rateLimit:` on a createMethod
// definition registers a rule here. The real package throttles DDP messages,
// which the harness has none of; what a test can meaningfully check is that the rules
// were registered at all, and against which methods — so record them.
const rules = [];

export const DDPRateLimiter = {
  addRule(matcher, numRequests, intervalMs) {
    const id = `rule_${rules.length + 1}`;
    rules.push({ id, matcher, numRequests, intervalMs });
    return id;
  },
};

export function registeredRateLimits() {
  return rules;
}
