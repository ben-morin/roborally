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

// Works on a full server-side user document and on the projected one the `onlineUsers`
// publication sends, which carries `profile.name` but no `emails`. The email branch is
// the fallback for accounts created before display names were stored; the startup
// backfill in server/accounts.ts retires it for existing users.
export function getUsername(user: Meteor.User) {
  if (user.profile?.name) {
    return user.profile.name;
  }
  const address = user.emails?.[0]?.address;
  return address ? displayNameFromEmail(address) : user._id;
}
