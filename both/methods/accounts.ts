import './config.ts';
import { createMethod } from 'meteor/jam:method';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';

// The two methods the local accounts-ui package calls, and the only two that are `open`:
// both run before a login exists — `isEmailAvailable` from the "forgot password" panel,
// `resendVerificationEmail` from the unverified-email one — so the package's built-in
// logged-in check has to be switched off for them.
//
// Neither may ever run on the client: one reads `process.env`, the other calls a
// server-only `Accounts` API. Two things keep them off it. They are server-only through
// the global `serverOnly: true` in ./config.ts, so no client stub is registered; and
// nothing under `client/` imports this module — only `server/cron.ts` does, as a
// side-effect import — so it is not even in the client bundle. Keep it that way: an
// import from a view module would ship both bodies to the browser.

export const isEmailAvailable = createMethod({
  name: 'isEmailAvailable',
  open: true,
  // No `validate`, and none is required: `run` takes no argument, so there is nothing to
  // check. The package only insists on a validator when `run.length !== 0`.
  run() {
    return !!process.env.EMAIL_URL || Meteor.isDevelopment;
  },
});

export const resendVerificationEmail = createMethod({
  name: 'resendVerificationEmail',
  open: true,
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
