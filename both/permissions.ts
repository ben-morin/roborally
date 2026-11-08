// check that the userId specified owns the documents
export function ownsDocument(userId: string, doc: { userId?: string } | null | undefined) {
  return doc && doc.userId === userId;
}

import { nameProblem } from './displayName.ts';

// The fallback username: the local part of the address, lowercased, exactly as written.
// `Accounts.onCreateUser` in server/accounts.ts uses it when no name was chosen, and the
// result still has to pass `checkNameAsync` below like any other.
export function displayNameFromEmail(address: string) {
  return address.split('@')[0].toLowerCase();
}

// Every write of a username goes through here: the shape from ./displayName.ts, then free
// across every other account, ignoring case — the name is what chat, the player lists and
// the rankings show, so two alike would let one player pass as another. Returns the trimmed
// name to store. Reads every account's name; fine at this app's size.
export async function checkNameAsync(name: string, exceptUserId?: string) {
  const problem = nameProblem(name);
  if (problem) throw new Meteor.Error(400, problem);
  const trimmed = name.trim();
  const others = await Meteor.users
    .find(exceptUserId ? { _id: { $ne: exceptUserId } } : {}, {
      fields: { 'profile.name': 1, emails: 1 },
    })
    .fetchAsync();
  if (others.some((user) => getUsername(user).toLowerCase() === trimmed.toLowerCase())) {
    throw new Meteor.Error(409, 'That username is taken.');
  }
  return trimmed;
}

// The sign-up allowlist (`ALLOWED_EMAILS` / `ALLOWED_DOMAINS`), also asked of a user's own
// email change so the gate cannot be walked around afterwards. Both lists empty lets anyone
// in. The address is lowercased and the settings compared as written, so an uppercase entry
// in settings never matches; the domain is what follows the last @, so an address holding
// two cannot smuggle an allowed one in. Private settings: on the client this says yes.
export function isAllowedEmail(address: string) {
  const allowedEmails: unknown[] = Meteor.settings?.ALLOWED_EMAILS || [];
  const allowedDomains: unknown[] = Meteor.settings?.ALLOWED_DOMAINS || [];
  if (allowedEmails.length === 0 && allowedDomains.length === 0) return true;
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return (
    allowedEmails.includes(address.toLowerCase()) || allowedDomains.includes(domain.toLowerCase())
  );
}

// `ADMIN_EMAILS` from settings, lowercased. A single string is taken as a one-item list,
// so a hand-written setting that leaves out the brackets still names its admin. Private
// settings never reach the browser, so on the client this is always empty.
export function adminEmails(): string[] {
  const setting: unknown = Meteor.settings?.ADMIN_EMAILS;
  const list = typeof setting === 'string' ? [setting] : Array.isArray(setting) ? setting : [];
  return list.filter((a): a is string => typeof a === 'string').map((a) => a.toLowerCase());
}

// Admin rights belong to an address, not to an account: any address on the user that is in
// `ADMIN_EMAILS`. With VERIFY_EMAILS on it must also be verified — the same trust the login
// gate in server/accounts.ts asks for. Read per call, so a settings change needs no restart
// of anything that cached it.
export function isAdminUser(user: Meteor.User | null | undefined) {
  const admins = adminEmails();
  if (!user || admins.length === 0) return false;
  const mustBeVerified = !!Accounts._options.sendVerificationEmail;
  return (user.emails ?? []).some(
    (email) => admins.includes(email.address.toLowerCase()) && (email.verified || !mustBeVerified)
  );
}

// Set only around an admin's `Accounts.createUserAsync`, so the sign-up allowlist in
// server/accounts.ts lets that one creation through. Never a module flag or an `options`
// field: a flag would also let in a sign-up running at the same moment, and `options` is
// whatever the sign-up form sent. Meteor 3 keeps the value in AsyncLocalStorage, so it
// follows the awaits inside the creation and nothing else (measured in `meteor shell`
// 2026-11-07, with a plain creation running alongside).
export const adminCreatingUser = new Meteor.EnvironmentVariable<boolean>();

// The first line of every admin method. Returns the caller, so a method can tell when it is
// acting on the admin's own account.
export async function requireAdminAsync() {
  const user = await Meteor.userAsync();
  if (!user || !isAdminUser(user)) {
    throw new Meteor.Error(403, 'Admins only.');
  }
  return user;
}

// Works on a full server-side user document, on the projected one the `onlineUsers`
// publication sends, which carries `profile.name` but no `emails`, and on the admin list's
// own cut-down documents — hence the three fields and not a whole `Meteor.User`. The email
// branch is the fallback for accounts created before display names were stored; the startup
// backfill in server/backfill.ts retires it for existing users.
export function getUsername(user: Pick<Meteor.User, '_id' | 'profile' | 'emails'>) {
  if (user.profile?.name) {
    return user.profile.name;
  }
  const address = user.emails?.[0]?.address;
  return address ? displayNameFromEmail(address) : user._id;
}
