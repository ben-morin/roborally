// Everything about accounts: who may register and log in (the `Meteor.settings`-driven
// allowlist and email-verification gate), the display name every user document carries,
// and the write rules on Meteor.users.
//
// Why it matters: `Meteor.users` documents carry `services.password.bcrypt`,
// `services.resume.loginTokens`, `services.password.reset`,
// `services.email.verificationTokens`, and the `status.lastLogin.ipAddr` /
// `status.lastLogin.userAgent` that mizzao:user-status writes. Meteor projects fields
// only on the *automatic* publication of the current user; a custom cursor publishes
// whole documents. See the projection on `onlineUsers` in server/publications.ts — this
// file is what makes that projection sufficient, by putting a display name somewhere
// safe to publish.
import {
  adminCreatingUser,
  adminEmails,
  checkNameAsync,
  displayNameFromEmail,
  getUsername,
  isAllowedEmail,
} from '../both/permissions.ts';

// accounts-base's `setupUsersCollection` installs an allow rule that lets a logged-in
// client update the `profile` field of its own document. Nothing in this app writes to
// Meteor.users from the client, and `profile.name` is the display name every chat line,
// player row and highscore entry is stamped with — so a client-side write here is only
// ever an attempt to appear as somebody else. `deny` wins over `allow`, so this closes
// it. `insert` and `remove` need no rule: no `allow` covers them, and a write with no
// matching allow rule is refused.
Meteor.users.deny({ update: () => true });

// Inside startup because the allowlist, the gate and the mail settings all read
// `Meteor.settings`, and because `onCreateUser` permits a single registration. This runs
// ahead of the startup block in server/main.ts — import order — and nothing here depends on
// what that block does.
Meteor.startup(async () => {
  Accounts.config({
    ambiguousErrorMessages: false,
    sendVerificationEmail: Meteor.settings?.VERIFY_EMAILS || false,
  });

  Accounts.emailTemplates.siteName = 'RoboRally';
  if (Meteor.settings?.MAIL_FROM) {
    Accounts.emailTemplates.from = Meteor.settings.MAIL_FROM;
  }

  Accounts.validateNewUser((user: Meteor.User) => {
    // The allowlist decides who may sign up. An admin adding a user has already decided.
    if (adminCreatingUser.get()) return true;

    const email = user.emails?.[0]?.address;
    if (!email || isAllowedEmail(email)) return true;
    throw new Meteor.Error(403, "Email isn't allowed to register on this server.");
  });

  // The username rule, for every new account — signed up or added by an admin. Its own hook,
  // so the admin's allowlist skip above can never skip it. `onCreateUser` below has already
  // put the name on the document by the time this runs.
  Accounts.validateNewUser(async (user: Meteor.User) => {
    await checkNameAsync(user.profile?.name ?? '', user._id);
    return true;
  });

  Accounts.validateLoginAttempt((attempt: { allowed: boolean; user?: Meteor.User }) => {
    if (!attempt.allowed) {
      return false;
    }

    if (Accounts._options.sendVerificationEmail) {
      // An allowed attempt always carries the user it authenticated; only a rejected one
      // can be without, and those returned above.
      const user = attempt.user!;
      if (user.emails && !user.emails.some((email) => email.verified)) {
        throw new Meteor.Error(
          'email-not-verified',
          'You must verify your email address before logging in. Please check your inbox.'
        );
      }
    }

    return true;
  });

  // Every user document gets a `profile.name` here; accounts from before this hook get
  // theirs from the startup backfill in server/backfill.ts.
  Accounts.onCreateUser((options, user) => {
    // `options.profile` is whatever the sign-up form sent, so only the chosen name is taken
    // from it, and the username hook above checks that like any other; nothing else in it is
    // copied. Without a chosen name, the address gives one. `_id` is already assigned by the
    // time this hook runs.
    // @types/meteor types `options.profile` as `{}`; read the one key this hook wants.
    const profile: { name?: unknown } | undefined = options.profile;
    const chosen = profile?.name;
    const address = user.emails?.[0]?.address;
    const derived = address ? displayNameFromEmail(address) : user._id;
    user.profile = { name: typeof chosen === 'string' ? chosen.trim() : derived };
    return user;
  });

  // A listed address with no account yet is up for grabs: whoever registers it first is an
  // admin, and with VERIFY_EMAILS off nothing proves they own it. `warn`, not `log`, so a
  // production server says it too.
  for (const address of adminEmails()) {
    // Case-insensitive, as sign-up's own duplicate check is. @types/meteor still types it
    // as synchronous; in Meteor 3 it returns a promise.
    if (!(await Accounts.findUserByEmail(address))) {
      console.warn(
        `ADMIN_EMAILS lists ${address}, which has no account yet. Whoever registers it first becomes an admin — sign up with it now.`
      );
    }
  }

  // Usernames have been unique since 2026-11. A repeat from before stays until an admin
  // renames it on the user manager; this names each one.
  const holders = new Map<string, number>();
  const users = await Meteor.users
    .find({}, { fields: { 'profile.name': 1, emails: 1 } })
    .fetchAsync();
  for (const user of users) {
    const key = getUsername(user).toLowerCase();
    holders.set(key, (holders.get(key) ?? 0) + 1);
  }
  for (const [name, count] of holders) {
    if (count > 1) {
      console.warn(
        `The username "${name}" belongs to ${count} accounts. Usernames are unique now: rename all but one on the admin screen.`
      );
    }
  }
});
