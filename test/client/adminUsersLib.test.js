// The user manager's row logic: presence, the sign-in address and the filter.
import { describe, expect, it } from 'vitest';
import { matchesFilter, presenceOf, primaryEmail } from '../../client/lib/adminUsers.ts';

const ann = {
  _id: 'ann',
  profile: { name: 'Annie' },
  emails: [
    { address: 'ann@example.com', verified: true },
    { address: 'Work@Corp.com', verified: false },
  ],
};

describe('presenceOf', () => {
  it('reads online, idle and offline, and treats no status as offline', () => {
    expect(presenceOf({ _id: 'a', status: { online: true } })).toBe('online');
    expect(presenceOf({ _id: 'a', status: { online: true, idle: true } })).toBe('idle');
    expect(presenceOf({ _id: 'a', status: { online: false, idle: true } })).toBe('offline');
    expect(presenceOf({ _id: 'a' })).toBe('offline');
  });
});

describe('primaryEmail', () => {
  it('is the first address, or nothing', () => {
    expect(primaryEmail(ann)).toEqual({ address: 'ann@example.com', verified: true });
    expect(primaryEmail({ _id: 'x' })).toBeUndefined();
  });
});

describe('matchesFilter', () => {
  it('matches everything when the filter is blank', () => {
    expect(matchesFilter(ann, '')).toBe(true);
    expect(matchesFilter(ann, '   ')).toBe(true);
  });

  it('matches the name or any address, ignoring case and outer spaces', () => {
    expect(matchesFilter(ann, 'annie')).toBe(true);
    expect(matchesFilter(ann, ' EXAMPLE ')).toBe(true);
    expect(matchesFilter(ann, 'corp.com')).toBe(true);
  });

  it('does not match what is in neither', () => {
    expect(matchesFilter(ann, 'bob')).toBe(false);
    expect(matchesFilter({ _id: 'x' }, 'x')).toBe(false);
  });
});
