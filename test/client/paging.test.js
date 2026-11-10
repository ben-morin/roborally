// The admin lists' pages: ten to a page, counted from one, clamped into range.
import { describe, expect, it } from 'vitest';
import { pageOf, paginate } from '../../client/lib/paging.ts';

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
