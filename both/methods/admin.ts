import './config.ts';
import { createMethod } from 'meteor/jam:method';
import { buildHighscoresAsync } from '../gamestate.ts';
import {
  adminCreatingUser,
  checkNameAsync,
  displayNameFromEmail,
  getUsername,
  isAdminUser,
  requireAdminAsync,
} from '../permissions.ts';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';
import { Chat } from '../../collections/chat.ts';
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
export const MAX_PASSWORD_LENGTH = 256;

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Meteor.Error(400, 'Password must be at least 6 characters long');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Meteor.Error(400, `Password must be at most ${MAX_PASSWORD_LENGTH} characters long`);
  }
}

// The admin's typed username, or — left empty — the one the address gives, as sign-up used
// to. A derived name that fails says so, since the admin never typed it.
async function usernameForNewAccountAsync(name: string, address: string) {
  if (name.trim()) return checkNameAsync(name);
  const derived = displayNameFromEmail(address);
  try {
    return await checkNameAsync(derived);
  } catch (error) {
    if (!(error instanceof Meteor.Error)) throw error;
    throw new Meteor.Error(
      error.error,
      `The username "${derived}" from the email cannot be used: ${error.reason} Type one instead.`
    );
  }
}

async function findGameAsync(gameId: string) {
  const game = await Games.findOneAsync(gameId);
  if (!game) {
    throw new Meteor.Error(404, 'Game not found.');
  }
  return game;
}

// A driver mid-PLAY claims every second or so, so one lost claim is ordinary; a fresh read
// carries the new `step`, and the driver's next claim then fails and it stops.
const END_GAME_TRIES = 3;

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

    // An unchanged name is not checked again, so an older one that breaks today's rule does
    // not block an email change. A change of case is a change, and is checked.
    const newName =
      name.trim() === user.profile?.name ? name.trim() : await checkNameAsync(name, userId);
    const newAddress = email.trim();
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
    // The ranking shows each account's current username; without this it would wait for a
    // game to end or the hourly rebuild.
    if (newName !== getUsername(user)) await buildHighscoresAsync();
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
    // A row shows the account's current name over the one it stored. With the account gone
    // only the stored name is left, so every row takes the last name first.
    const name = getUsername(user);
    await Chat.updateAsync({ userId }, { $set: { author: name } }, { multi: true });
    await Players.updateAsync({ userId }, { $set: { name } }, { multi: true });
    await Games.updateAsync({ userId }, { $set: { author: name } }, { multi: true });
    await Games.updateAsync({ winnerUserId: userId }, { $set: { winner: name } }, { multi: true });
    // Finished games keep their rows; the ranking counts only accounts that exist, so the
    // rebuild drops this one. Each live session watches its login token, so removing the
    // document also logs the user out.
    await Meteor.users.removeAsync(userId);
    await buildHighscoresAsync();
  },
});

export const adminCreateUser = createMethod({
  name: 'adminCreateUser',
  validate: checkArgsWith(schemas.adminCreateUser),
  async run({ name, email, password, verified }: Doc<typeof schemas.adminCreateUser>) {
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
    const username = await usernameForNewAccountAsync(name, address);

    // `onCreateUser` takes the name from `profile`, and the username hook checks it once more.
    const profile = { name: username };
    const userId = await adminCreatingUser.withValue(true, () =>
      Accounts.createUserAsync(
        password ? { email: address, password, profile } : { email: address, profile }
      )
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

// For a game that is stuck: a parked one (its replays failed), or one the admin judges
// dead while somebody is still online, which the abandoned-game job would leave running.
export const adminEndGame = createMethod({
  name: 'adminEndGame',
  validate: checkArgsWith(schemas.adminEndGame),
  async run({ gameId }: Doc<typeof schemas.adminEndGame>) {
    const admin = await requireAdminAsync();
    for (let tries = 0; tries < END_GAME_TRIES; tries++) {
      const game = await findGameAsync(gameId);
      if (!game.started) {
        throw new Meteor.Error(409, 'This game has not started. Delete it instead.');
      }
      if (game.winner !== undefined) {
        throw new Meteor.Error(409, 'This game is already over.');
      }
      // Nobody wins: picking a winner is a judgment this screen cannot make.
      if (await game.endAsync(null)) {
        await game.chatAsync('An admin ended the game.');
        console.log(`Admin ${getUsername(admin)} ended game ${gameId}`);
        return;
      }
    }
    throw new Meteor.Error(409, 'The game moved while it was being ended. Try again.');
  },
});

// A lobby, or a game that is over. A running one is ended first: removing its rows under
// the turn chain would break the turn.
export const adminDeleteGame = createMethod({
  name: 'adminDeleteGame',
  validate: checkArgsWith(schemas.adminDeleteGame),
  async run({ gameId }: Doc<typeof schemas.adminDeleteGame>) {
    const admin = await requireAdminAsync();
    const game = await findGameAsync(gameId);
    if (game.started && game.winner === undefined) {
      throw new Meteor.Error(409, 'End the game first.');
    }
    await game.removeWithChildrenAsync();
    console.log(`Admin ${getUsername(admin)} deleted game ${gameId}`);
    // "Most played" counts the player rows of every game, a lobby's too, and "most won"
    // counts the winner — so any delete can move either list.
    await buildHighscoresAsync();
  },
});
