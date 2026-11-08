// The user manager's row logic: presence, the sign-in address, the filter and the pages.
import { describe, expect, it } from 'vitest';
import {
  matchesFilter,
  pageOf,
  paginate,
  presenceOf,
  primaryEmail,
} from '../../client/lib/adminUsers.ts';

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

describe('pageOf', () => {
  it('counts pages from one, ten items to a page', () => {
    expect(pageOf(0)).toBe(1);
    expect(pageOf(9)).toBe(1);
    expect(pageOf(10)).toBe(2);
    expect(pageOf(23)).toBe(3);
    expect(pageOf(4, 3)).toBe(2);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 23 }, (_, i) => i);

  it('cuts ten items to a page and counts the pages', () => {
    expect(paginate(items, 1)).toEqual({ items: items.slice(0, 10), page: 1, pageCount: 3 });
    expect(paginate(items, 3)).toEqual({ items: [20, 21, 22], page: 3, pageCount: 3 });
  });

  it('clamps a page past either end, so a list that shrank still lands on a real page', () => {
    expect(paginate(items, 9).page).toBe(3);
    expect(paginate(items, 0).page).toBe(1);
    expect(paginate(items.slice(0, 12), 3)).toEqual({
      items: [10, 11],
      page: 2,
      pageCount: 2,
    });
  });

  it('treats an empty list as one empty page', () => {
    expect(paginate([], 4)).toEqual({ items: [], page: 1, pageCount: 1 });
  });

  it('makes exactly ten one page', () => {
    expect(paginate(items.slice(0, 10), 1).pageCount).toBe(1);
  });
});
