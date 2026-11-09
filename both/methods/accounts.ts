import './config.ts';
import { createMethod } from 'meteor/jam:method';
import { buildHighscoresAsync } from '../gamestate.ts';
import { checkNameAsync, getUsername, isAdminUser, isAllowedEmail } from '../permissions.ts';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';

// The methods the accounts menu calls. Two are `open`, because they run before a login
// exists — `isEmailAvailable` from the "forgot password" panel, `resendVerificationEmail`
// from the unverified-email one — so jam:method's built-in logged-in check has to be
// switched off for them. `updateProfile` is the signed-in user's own Edit profile.
//
// None may ever run on the client: they read `process.env` or call server-only `Accounts`
// APIs. The global `serverOnly: true` in ./config.ts is what keeps them off it — no client
// stub is registered, so no body is ever reached in a browser. The accounts component
// imports these functions the way every view imports its methods, and the bodies ride
// along as dead code as every other method's do.

// Server-only: the browser has no `process.env`. In development Meteor prints a mail it
// cannot send to the log, which is enough to follow its link.
export function canSendMail() {
  return !!process.env.MAIL_URL || Meteor.isDevelopment;
}

export const isEmailAvailable = createMethod({
  name: 'isEmailAvailable',
  open: true,
  // No `validate`, and none is required: `run` takes no argument, so there is nothing to
  // check. The package only insists on a validator when `run.length !== 0`.
  run() {
    return canSendMail();
  },
});

export const resendVerificationEmail = createMethod({
  name: 'resendVerificationEmail',
  open: true,
  // Anonymous and it sends mail, so an unlimited loop here floods a real inbox.
  rateLimit: { limit: 2, interval: 60000 },
  validate: checkArgsWith(schemas.resendVerificationEmail),
  async run({ email }: Doc<typeof schemas.resendVerificationEmail>) {
    const user = await Meteor.users.findOneAsync({ 'emails.address': email });
    if (!user) {
      throw new Meteor.Error('user-not-found', 'No account found with that email address.');
    }
    // The selector above matched an address inside `emails`, so the array is there.
    if (user.emails!.some((e) => e.verified)) {
      throw new Meteor.Error('already-verified', 'Email is already verified.');
    }
    Accounts.sendVerificationEmail(user._id);
  },
});

// A user's own username and email, from Edit profile in the user menu. The username goes
// through the same rule as everywhere else, and only when it changed, so an older name that
// breaks today's rule never blocks an email change. A new email asks more, because it is the
// way into the account: the current password (an open session must not be enough to take an
// account over), the sign-up allowlist (or the gate could be walked around afterwards), free
// across accounts, never an admin's way off ADMIN_EMAILS, and — under VERIFY_EMAILS — a
// verification email, without which the next sign-in would be refused.
export const updateProfile = createMethod({
  name: 'updateProfile',
  // It checks a password, so it is a way to guess one.
  rateLimit: { limit: 5, interval: 60000 },
  validate: checkArgsWith(schemas.updateProfile),
  async run({ name, email, password }: Doc<typeof schemas.updateProfile>) {
    // `open: false` from ./config.ts, so the package's logged-in check has already run and
    // this cannot resolve to null — the `!` records the TypeError a missing user throws.
    const user = (await Meteor.userAsync())!;

    const newName =
      name.trim() === user.profile?.name ? name.trim() : await checkNameAsync(name, user._id);

    const oldAddress = user.emails?.[0]?.address;
    const newAddress = email.trim();
    const addressChanged = newAddress.toLowerCase() !== (oldAddress ?? '').toLowerCase();
    const verify = !!Accounts._options.sendVerificationEmail;

    if (addressChanged) {
      if (!newAddress.includes('@')) {
        throw new Meteor.Error(400, 'Invalid email');
      }
      if (!oldAddress) {
        throw new Meteor.Error(409, 'This account has no email address to change.');
      }
      if (!password) {
        throw new Meteor.Error(403, 'Type your current password to change your email.');
      }
      if ((await Accounts._checkPasswordAsync(user, password)).error) {
        throw new Meteor.Error(403, 'Incorrect password');
      }
      if (!isAllowedEmail(newAddress)) {
        throw new Meteor.Error(403, "That email isn't allowed on this server.");
      }
      // @types/meteor still types it as synchronous; in Meteor 3 it returns a promise.
      const holder = await Accounts.findUserByEmail(newAddress);
      if (holder && holder._id !== user._id) {
        throw new Meteor.Error(409, 'Another account already uses that email address.');
      }
      // A new address starts unverified, which under VERIFY_EMAILS is no admin rights.
      const edited = { ...user, emails: [{ address: newAddress, verified: false }] };
      if (isAdminUser(user) && !isAdminUser(edited)) {
        throw new Meteor.Error(
          409,
          'That change would remove your admin rights. Your address has to stay in ADMIN_EMAILS, and verified while VERIFY_EMAILS is on.'
        );
      }
      if (verify && !canSendMail()) {
        throw new Meteor.Error(
          409,
          'Email is not set up on this server, so a new address cannot be verified.'
        );
      }
      await Accounts.replaceEmailAsync(user._id, oldAddress, newAddress, false);
    }

    if (newName !== user.profile?.name) {
      await Meteor.users.updateAsync(user._id, { $set: { 'profile.name': newName } });
    }
    // The ranking shows each account's current username; without this it would wait for a
    // game to end or the hourly rebuild.
    if (newName !== getUsername(user)) await buildHighscoresAsync();

    const verificationSent = addressChanged && verify;
    if (verificationSent) {
      // @types/meteor types it `void`; in Meteor 3 it returns a promise.
      await Accounts.sendVerificationEmail(user._id);
    }
    return { verificationSent };
  },
});
