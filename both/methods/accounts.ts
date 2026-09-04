import './config.ts';
import { createMethod } from 'meteor/jam:method';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';

// The two methods the accounts menu calls, and the only two that are `open`: both run
// before a login exists — `isEmailAvailable` from the "forgot password" panel,
// `resendVerificationEmail` from the unverified-email one — so jam:method's built-in
// logged-in check has to be switched off for them.
//
// Neither may ever run on the client: one reads `process.env`, the other calls a
// server-only `Accounts` API. The global `serverOnly: true` in ./config.ts is what keeps
// them off it — no client stub is registered, so neither body is ever reached in a
// browser. The accounts component imports these functions the way every view imports its
// methods, and the bodies ride along as dead code exactly as the other thirteen do.

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
