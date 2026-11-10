// Ten to a page, for the admin lists. No React, no Meteor, no DOM.

export const PAGE_SIZE = 10;

/** The 1-based page that holds the item at `index`. */
export function pageOf(index: number, size = PAGE_SIZE) {
  return Math.floor(index / size) + 1;
}

/**
 * One page of `items`. `page` is 1-based and clamped into range, so a list that shrank under
 * the reader — a delete, a narrower filter — still lands on a real page. An empty list is
 * one empty page.
 */
export function paginate<T>(items: readonly T[], page: number, size = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * size;
  return { items: items.slice(start, start + size), page: current, pageCount };
}
