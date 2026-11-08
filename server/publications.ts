import { isAdminUser } from '../both/permissions.ts';
import { checkArgs, gameIdOnly } from '../both/schemas/methods.ts';
import { Cards } from '../collections/cards.ts';
import { Chat } from '../collections/chat.ts';
import { Games } from '../collections/games.ts';
import { Highscores } from '../collections/highscores.ts';
import { Players } from '../collections/players.ts';
import { nudgeGameAsync } from './resume.ts';

// Whole game documents go out to every client here, so the per-turn snapshot — a copy of
// the players, cards and deck as they were when the current segment started — is projected
// away. It is several kilobytes, it is server-only bookkeeping, and no template reads it.
Meteor.publish('games', function () {
  return Games.find({}, { limit: 10, sort: { submitted: -1 }, fields: { segmentSnapshot: 0 } });
});

Meteor.publish('chat', async function (gameId: string) {
  checkArgs({ gameId }, gameIdOnly);
  const size = Math.max(0, (await Chat.find({ gameId }).countAsync()) - 100);
  return Chat.find({ gameId }, { skip: size });
});

// The only publication that hands out documents belonging to somebody else, so it is the
// one that has to say what it sends. Meteor projects fields on the *automatic*
// publication of the current user; a custom cursor like this one publishes whole
// documents, which for Meteor.users means the bcrypt hash, the resume login tokens, the
// password-reset and email-verification tokens, and the IP address and user agent
// mizzao:user-status records in `status.lastLogin`.
//
// `profile.name` is the display name server/accounts.ts stores at sign-up, so no email
// address leaves the server either. `status.idle` is here because the pill colours an
// idle player differently; it is presence, same as `status.online`.
Meteor.publish('onlineUsers', function () {
  // Who else is here is not public. The pill was hidden from logged-out visitors in
  // edae2ce; this is the half that stops the data being sent in the first place.
  if (!this.userId) return this.ready();

  return Meteor.users.find(
    { 'status.online': true },
    { fields: { 'profile.name': 1, 'status.online': 1, 'status.idle': 1 } }
  );
});

// Every account, for the admin user manager. Same rule as `onlineUsers`: the projection is
// what keeps `services` (password hash, login, reset and verification tokens) on the
// server, and `lastLogin` is cut down to its date — the IP address and user agent stay too.
const ADMIN_USER_FIELDS = {
  emails: 1,
  'profile.name': 1,
  createdAt: 1,
  'status.online': 1,
  'status.idle': 1,
  'status.lastLogin.date': 1,
};

// Sent as the client-only `adminUsers` collection, not into `Meteor.users`. Meteor merges
// what two publications send about one document per top-level field only, so for an online
// user `onlineUsers`' `status` won over this one's and the last-login date never arrived
// (seen on the first screenshot, 2026-11-07). Its own collection also leaves the admin's
// `Meteor.users` holding what every other screen expects.
Meteor.publish('adminUsers', async function () {
  // Not an error, the same as `onlineUsers` for a visitor: a non-admin just gets nothing.
  if (!this.userId || !isAdminUser(await Meteor.users.findOneAsync(this.userId))) {
    return this.ready();
  }

  // @types/meteor types it as synchronous; on Meteor 3's server it returns a promise.
  const handle = await Meteor.users.find({}, { fields: ADMIN_USER_FIELDS }).observeChanges({
    added: (id, fields) => this.added('adminUsers', id, fields),
    changed: (id, fields) => this.changed('adminUsers', id, fields),
    removed: (id) => this.removed('adminUsers', id),
  });
  this.onStop(() => handle.stop());
  this.ready();
});

// Subscribing here is a browser opening /board/:id — including one reconnecting after a
// restart, since DDP re-sends its subscriptions. That makes this the earliest the server
// hears that somebody is waiting on a turn which died with the last process, so it is where
// the wait for the stalled-turn sweep gets cut short. Deliberately not awaited: the nudge
// replays a whole segment and the subscription must not sit behind it.
Meteor.publish('players', function (gameId: string) {
  checkArgs({ gameId }, gameIdOnly);
  nudgeGameAsync(gameId, this.userId).catch((err) =>
    console.error(`nudge failed for game ${gameId}`, err)
  );
  return Players.find({ gameId });
});

Meteor.publish('cards', function (gameId: string) {
  checkArgs({ gameId }, gameIdOnly);
  // A logged-out subscriber's null `userId` goes through as it is and matches no card,
  // which is the right answer — so the assertion is about the schema calling the field a
  // string, not about the null being impossible.
  return Cards.find({ gameId, userId: this.userId as string });
});

Meteor.publish('highscores', function () {
  return Highscores.find();
});
