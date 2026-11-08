// The shape a username must have — the half of the rule with no database in it, which the
// sign-up form also uses before the round trip.
import { describe, expect, it } from 'vitest';
import { NAME_MAX, NAME_MIN, nameProblem } from '../../both/displayName.ts';

describe('nameProblem', () => {
  it('accepts 3 to 20 characters of anything, after trimming', () => {
    expect([NAME_MIN, NAME_MAX]).toEqual([3, 20]);
    expect(nameProblem('ben')).toBeNull();
    expect(nameProblem('x'.repeat(20))).toBeNull();
    expect(nameProblem('  Ben Morin!  ')).toBeNull();
    expect(nameProblem('  ab  c ')).toBeNull();
  });

  it('asks for a name when there is none', () => {
    expect(nameProblem('')).toBe('Username is required.');
    expect(nameProblem('   ')).toBe('Username is required.');
  });

  it('refuses 2 or 21 characters, counting after the trim', () => {
    expect(nameProblem('ab')).toBe('Username must be 3 to 20 characters long.');
    expect(nameProblem('  ab  ')).toBe('Username must be 3 to 20 characters long.');
    expect(nameProblem('x'.repeat(21))).toBe('Username must be 3 to 20 characters long.');
  });

  it('refuses "Nobody" in any case, the no-winner word', () => {
    expect(nameProblem('Nobody')).toBe('That username is reserved.');
    expect(nameProblem(' NOBODY ')).toBe('That username is reserved.');
    expect(nameProblem('nobody1')).toBeNull();
  });
});
