// Everything that keeps a user document from being readable or writable by a client that
// has no business with it. The login-gating half of the Accounts configuration — the
// registration allowlist and the email-verification gate — lives in server/cron.js's
// `Meteor.startup` block, because it is settings-driven; this file is about the shape and
// ownership of the documents themselves.
//
// Why it matters: `Meteor.users` documents carry `services.password.bcrypt`,
// `services.resume.loginTokens`, `services.password.reset`,
// `services.email.verificationTokens`, and the `status.lastLogin.ipAddr` /
// `status.lastLogin.userAgent` that mizzao:user-status writes. Meteor projects fields
// only on the *automatic* publication of the current user; a custom cursor publishes
// whole documents. See the projection on `onlineUsers` in server/publications.js — this
// file is what makes that projection sufficient, by putting a display name somewhere
// safe to publish.
import { displayNameFromEmail, getUsername } from '../both/permissions.js';

// accounts-base's `setupUsersCollection` installs an allow rule that lets a logged-in
// client update the `profile` field of its own document. Nothing in this app writes to
// Meteor.users from the client, and `profile.name` is the display name every chat line,
// player row and highscore entry is stamped with — so a client-side write here is only
// ever an attempt to appear as somebody else. `deny` wins over `allow`, so this closes
// it. `insert` and `remove` need no rule: no `allow` covers them, and a write with no
// matching allow rule is refused.
Meteor.users.deny({ update: () => true });

Meteor.startup(async () => {
  // Registered here rather than at module scope so it sits beside the backfill it feeds:
  // both exist to guarantee every user document has a `profile.name`. Meteor permits a
  // single registration and startup runs once.
  Accounts.onCreateUser((options, user) => {
    // `options.profile` is whatever the sign-up form sent, i.e. client-controlled, and
    // this is the one field the publication exposes to other players — so it is derived
    // from the (server-validated) address instead of accepted. `_id` is already assigned
    // by the time this hook runs.
    const address = user.emails?.[0]?.address;
    user.profile = { name: address ? displayNameFromEmail(address) : user._id };
    return user;
  });

  // Accounts created before display names were stored server-side have no `profile.name`,
  // and the publication no longer sends anything a name could be derived from — they
  // would show up as blank pills. Only `emails` is read, so ask for only that.
  const legacy = await Meteor.users
    .find({ 'profile.name': { $exists: false } }, { fields: { emails: 1 } })
    .fetchAsync();

  for (const user of legacy) {
    await Meteor.users.updateAsync(user._id, { $set: { 'profile.name': getUsername(user) } });
  }

  if (legacy.length) {
    console.log(`Backfilled profile.name for ${legacy.length} user(s)`);
  }
});
