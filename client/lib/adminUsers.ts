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
