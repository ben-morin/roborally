import './config.ts';
import { createMethod } from 'meteor/jam:method';
import { adminCreatingUser, getUsername, isAdminUser, requireAdminAsync } from '../permissions.ts';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';
import { Games } from '../../collections/games.ts';
import { Players } from '../../collections/players.ts';
import { canSendMail } from './accounts.ts';

// The admin screens' methods. Every one decides admin rights on the server, from the
// private `ADMIN_EMAILS` setting; the browser only ever learns the yes/no answer below.

// The accounts panel's own rule (`validatePassword` in client/lib/accounts.ts), so an admin
// cannot set a password the user could not have chosen.
const MIN_PASSWORD_LENGTH = 6;
// accounts-password's default `passwordMaxLength`. Past it, `setPasswordAsync` fails a
// `check` and the admin would see a bare 500 instead of a reason.
const MAX_PASSWORD_LENGTH = 256;

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Meteor.Error(400, 'Password must be at least 6 characters long');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Meteor.Error(400, `Password must be at most ${MAX_PASSWORD_LENGTH} characters long`);
  }
}

async function findUserAsync(userId: string) {
  const user = await Meteor.users.findOneAsync(userId);
  if (!user) {
    throw new Meteor.Error(404, 'User not found.');
  }
  return user;
}

// A game the user owns or sits in that has not finished. Every end-of-game path writes
// `winner` ('Nobody' included), so a game without one is a lobby or still being played.
async function unfinishedGameOfAsync(userId: string) {
  const owned = await Games.findOneAsync({ userId, winner: { $exists: false } });
  if (owned) return owned;
  for (const { gameId } of await Players.find({ userId }, { fields: { gameId: 1 } }).fetchAsync()) {
    const game = await Games.findOneAsync({ _id: gameId, winner: { $exists: false } });
    if (game) return game;
  }
  return undefined;
}

export const isAdmin = createMethod({
  name: 'isAdmin',
  // No argument, so no validator: the package only insists on one when `run.length !== 0`.
  async run() {
    return isAdminUser(await Meteor.userAsync());
  },
});

// The user manager marks admin accounts and offers no Delete on them. The browser cannot
// work that out itself: it never sees ADMIN_EMAILS.
export const adminAccountIds = createMethod({
  name: 'adminAccountIds',
  async run() {
    await requireAdminAsync();
    const users = await Meteor.users.find({}, { fields: { emails: 1 } }).fetchAsync();
    return users.filter((user) => isAdminUser(user)).map((user) => user._id);
  },
});

export const adminUpdateUser = createMethod({
  name: 'adminUpdateUser',
  validate: checkArgsWith(schemas.adminUpdateUser),
  async run({ userId, name, email, verified }: Doc<typeof schemas.adminUpdateUser>) {
    const admin = await requireAdminAsync();
    const user = await findUserAsync(userId);

    const newName = name.trim();
    const newAddress = email.trim();
    if (!newName) {
      throw new Meteor.Error(400, 'Name is required.');
    }
    if (!newAddress.includes('@')) {
      throw new Meteor.Error(400, 'Invalid email');
    }
    const oldAddress = user.emails?.[0]?.address;
    if (!oldAddress) {
      throw new Meteor.Error(409, 'This account has no email address to change.');
    }

    // Login is case-insensitive, so a change of case alone is no change.
    const addressChanged = newAddress.toLowerCase() !== oldAddress.toLowerCase();
    if (addressChanged) {
      // @types/meteor still types it as synchronous; in Meteor 3 it returns a promise.
      const holder = await Accounts.findUserByEmail(newAddress);
      if (holder && holder._id !== userId) {
        throw new Meteor.Error(409, 'Another account already uses that email address.');
      }
    }

    // Admin rights follow the address, so an admin editing their own could lock themselves
    // out. Judge the account as it would be after the edit.
    if (userId === admin._id) {
      const edited = {
        ...user,
        emails: [
          { address: addressChanged ? newAddress : oldAddress, verified },
          ...(user.emails ?? []).slice(1),
        ],
      };
      if (!isAdminUser(edited)) {
        throw new Meteor.Error(
          409,
          'That change would remove your admin rights. Your address has to stay in ADMIN_EMAILS, and verified while VERIFY_EMAILS is on.'
        );
      }
    }

    if (addressChanged) {
      await Accounts.replaceEmailAsync(userId, oldAddress, newAddress, verified);
      await Meteor.users.updateAsync(userId, { $set: { 'profile.name': newName } });
    } else {
      await Meteor.users.updateAsync(userId, {
        $set: { 'profile.name': newName, 'emails.0.verified': verified },
      });
    }
  },
});

export const adminSetPassword = createMethod({
  name: 'adminSetPassword',
  validate: checkArgsWith(schemas.adminSetPassword),
  async run({ userId, password }: Doc<typeof schemas.adminSetPassword>) {
    await requireAdminAsync();
    await findUserAsync(userId);
    checkPassword(password);
    // Logs the user out everywhere, which is the point when a password was compromised.
    await Accounts.setPasswordAsync(userId, password);
  },
});

export const adminSendResetEmail = createMethod({
  name: 'adminSendResetEmail',
  validate: checkArgsWith(schemas.adminSendResetEmail),
  async run({ userId }: Doc<typeof schemas.adminSendResetEmail>) {
    await requireAdminAsync();
    await findUserAsync(userId);
    if (!canSendMail()) {
      throw new Meteor.Error(409, 'Email is not set up on this server.');
    }
    // @types/meteor types it `void`; in Meteor 3 it returns a promise.
    await Accounts.sendResetPasswordEmail(userId);
  },
});

export const adminSendVerificationEmail = createMethod({
  name: 'adminSendVerificationEmail',
  validate: checkArgsWith(schemas.adminSendVerificationEmail),
  async run({ userId }: Doc<typeof schemas.adminSendVerificationEmail>) {
    await requireAdminAsync();
    const user = await findUserAsync(userId);
    if (!user.emails?.some((e) => !e.verified)) {
      throw new Meteor.Error(409, 'That email address is already verified.');
    }
    if (!canSendMail()) {
      throw new Meteor.Error(409, 'Email is not set up on this server.');
    }
    // @types/meteor types it `void`; in Meteor 3 it returns a promise.
    await Accounts.sendVerificationEmail(userId);
  },
});

export const adminLogoutUser = createMethod({
  name: 'adminLogoutUser',
  validate: checkArgsWith(schemas.adminLogoutUser),
  async run({ userId }: Doc<typeof schemas.adminLogoutUser>) {
    await requireAdminAsync();
    await findUserAsync(userId);
    // What accounts-base's own `_clearAllLoginTokens` writes. Each live connection watches
    // its token, so removing them closes the user's sessions too, not just future logins.
    await Meteor.users.updateAsync(userId, { $set: { 'services.resume.loginTokens': [] } });
  },
});

export const adminDeleteUser = createMethod({
  name: 'adminDeleteUser',
  validate: checkArgsWith(schemas.adminDeleteUser),
  async run({ userId }: Doc<typeof schemas.adminDeleteUser>) {
    const admin = await requireAdminAsync();
    // By id and first, so it holds whatever the admin rule becomes.
    if (userId === admin._id) {
      throw new Meteor.Error(403, "You can't delete your own account.");
    }
    const user = await findUserAsync(userId);
    // The address stays in ADMIN_EMAILS, so its next sign-up would be an admin again.
    if (isAdminUser(user)) {
      throw new Meteor.Error(
        403,
        'That account is an admin. Remove its address from ADMIN_EMAILS first.'
      );
    }
    // Removing a robot mid-turn would break the turn chain. The wait is short: the cron
    // jobs clean up a lobby whose owner is offline and end a game nobody is online for.
    const game = await unfinishedGameOfAsync(userId);
    if (game) {
      throw new Meteor.Error(
        409,
        `${getUsername(user)} is still in the game "${game.name}". Delete them once it is over; games with nobody online end by themselves within a few minutes.`
      );
    }
    // Finished games keep their player rows and the names stamped on them, so the rankings
    // keep the counts and fall back to the stamped name. Each live session watches its
    // login token, so removing the document also logs the user out.
    await Meteor.users.removeAsync(userId);
  },
});

export const adminCreateUser = createMethod({
  name: 'adminCreateUser',
  validate: checkArgsWith(schemas.adminCreateUser),
  async run({ email, password, verified }: Doc<typeof schemas.adminCreateUser>) {
    await requireAdminAsync();
    const address = email.trim().toLowerCase();
    if (!address.includes('@')) {
      throw new Meteor.Error(400, 'Invalid email');
    }
    // An empty password means "let them choose it": the reset link sets the first one.
    if (password) {
      checkPassword(password);
    } else if (!canSendMail()) {
      throw new Meteor.Error(409, 'Email is not set up on this server. Type a password instead.');
    }
    // @types/meteor still types it as synchronous; in Meteor 3 it returns a promise.
    if (await Accounts.findUserByEmail(address)) {
      throw new Meteor.Error(409, 'An account with that email address already exists.');
    }

    // `onCreateUser` still derives the display name from the address.
    const userId = await adminCreatingUser.withValue(true, () =>
      Accounts.createUserAsync(password ? { email: address, password } : { email: address })
    );
    if (verified) {
      await Meteor.users.updateAsync(userId, { $set: { 'emails.0.verified': true } });
    }
    if (!password) {
      // @types/meteor types it `void`; in Meteor 3 it returns a promise.
      await Accounts.sendResetPasswordEmail(userId);
    }
    // So the screen can open the new account.
    return userId;
  },
});
