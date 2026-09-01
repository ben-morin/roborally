import { checkArgs, gameIdOnly } from '../both/schemas/methods.js';
import { Cards } from '../collections/cards.js';
import { Chat } from '../collections/chat.js';
import { Games } from '../collections/games.js';
import { Highscores } from '../collections/highscores.js';
import { Players } from '../collections/players.js';
import { nudgeGameAsync } from './resume.js';

// Whole game documents go out to every client here, so the per-turn snapshot — a copy of
// the players, cards and deck as they were when the current segment started — is projected
// away. It is several kilobytes, it is server-only bookkeeping, and no template reads it.
Meteor.publish('games', function () {
  return Games.find({}, { limit: 10, sort: { submitted: -1 }, fields: { segmentSnapshot: 0 } });
});

Meteor.publish('chat', async function (gameId) {
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
// `profile.name` is the display name server/accounts.js stores at sign-up, so no email
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

// Subscribing here is a browser opening /board/:id — including one reconnecting after a
// restart, since DDP re-sends its subscriptions. That makes this the earliest the server
// hears that somebody is waiting on a turn which died with the last process, so it is where
// the wait for the stalled-turn sweep gets cut short. Deliberately not awaited: the nudge
// replays a whole segment and the subscription must not sit behind it.
Meteor.publish('players', function (gameId) {
  checkArgs({ gameId }, gameIdOnly);
  nudgeGameAsync(gameId, this.userId).catch((err) =>
    console.error(`nudge failed for game ${gameId}`, err)
  );
  return Players.find({ gameId });
});

Meteor.publish('cards', function (gameId) {
  checkArgs({ gameId }, gameIdOnly);
  return Cards.find({ gameId, userId: this.userId });
});

Meteor.publish('highscores', function () {
  return Highscores.find();
});
