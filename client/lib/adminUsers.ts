// The user manager's logic half: what a row says about a user and whether it matches the
// filter. No React, no Meteor, no DOM — client/views/admin/ is wiring over this.

export type Presence = 'online' | 'idle' | 'offline';

/** A document of the `adminUsers` publication: a user, cut down to what an admin sees. */
export interface AdminUserDoc {
  _id: string;
  emails?: { address: string; verified: boolean }[];
  profile?: { name?: string };
  createdAt?: Date;
  status?: { online?: boolean; idle?: boolean; lastLogin?: { date: Date } };
}

export function presenceOf(user: AdminUserDoc): Presence {
  if (!user.status?.online) return 'offline';
  return user.status.idle ? 'idle' : 'online';
}

/** The first address, which is the one an account signs in with here. */
export function primaryEmail(user: AdminUserDoc) {
  return user.emails?.[0];
}

/** Case-insensitive, on the display name or any address; an empty filter matches all. */
export function matchesFilter(user: AdminUserDoc, filter: string) {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [user.profile?.name ?? '', ...(user.emails ?? []).map((e) => e.address)];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

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
