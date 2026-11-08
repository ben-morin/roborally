// check that the userId specified owns the documents
export function ownsDocument(userId: string, doc: { userId?: string } | null | undefined) {
  return doc && doc.userId === userId;
}

// The display-name rule, in one place: the local part of the address, lowercased, exactly
// as written. `Accounts.onCreateUser` in server/accounts.ts stores the result as
// `profile.name` so the name — and only the name — is what leaves the server.
//
// It is NOT unique: two accounts on different allowlisted domains (ALLOWED_DOMAINS is
// plural) derive the same name. Nothing keys off it — every statistic aggregates on the
// account's `userId` — so a duplicate is a legibility problem, not a correctness one.
export function displayNameFromEmail(address: string) {
  return address.split('@')[0].toLowerCase();
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
