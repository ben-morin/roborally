import { getUsername } from '../both/permissions.js';
import { setBuildHighscores } from '../both/gamestate.js';
import { Games } from '../collections/games.js';
import { Highscores } from '../collections/highscores.js';
import { Players } from '../collections/players.js';

// Both lists group on the account's `userId`, never on a display name. `profile.name` is
// the local part of an email address, so two accounts on different allowlisted domains
// share one — and grouping on it silently merged their wins and their games played into a
// single ranking row. The consequence of the fix is that the same name can now appear
// twice in a list, once per account, with nothing on screen to tell them apart. That is
// accepted for now: two indistinguishable rows are honest, one merged row was not.
export async function buildHighscores() {
  console.log('Building Highscores');

  const mostWon = await Games.rawCollection()
    .aggregate([
      // `winnerUserId` is written only where there is a real winner, so its presence is
      // the whole filter: a game still in progress has none, and neither does one that
      // ended with 'Nobody'.
      //
      // A win by default — everyone else was destroyed, quit, or disconnected — counts the
      // same as reaching the last checkpoint. That is deliberate; the field records who
      // was left standing, not how.
      { $match: { winnerUserId: { $exists: true } } },
      // `stampedName` is any one of the group's `winner` values — the display name as it
      // was when that game ended. It is only ever used as a fallback label; see
      // addToHighscores.
      { $group: { _id: '$winnerUserId', count: { $sum: 1 }, stampedName: { $last: '$winner' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ])
    .toArray();

  const mostPlayed = await Players.rawCollection()
    .aggregate([
      { $group: { _id: '$userId', count: { $sum: 1 }, stampedName: { $last: '$name' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ])
    .toArray();

  await Highscores.removeAsync({});
  await addToHighscores(mostWon, 'mostWon');
  await addToHighscores(mostPlayed, 'mostPlayed');
}

// `both/gamestate.js` ends games and needs to rebuild the lists, but cannot import a
// server-only module. Hand it the implementation instead.
setBuildHighscores(buildHighscores);

// The group key is a userId; the ranking page shows names. Resolving the name from the
// account rather than reading the one stamped on the game or player document means the
// display name follows the account — the day players can rename themselves, old rankings
// will not keep showing the old name. The stamped name is the fallback for a userId with
// no account behind it any more, which beats printing a placeholder.
//
// `Highscores` is published to everyone including logged-out visitors, so the document
// deliberately carries the resolved name and not the userId.
async function addToHighscores(arr, type) {
  for (const [i, { _id: userId, count: value, stampedName }] of arr.entries()) {
    const user = userId
      ? await Meteor.users.findOneAsync(userId, { fields: { 'profile.name': 1, emails: 1 } })
      : undefined;
    await Highscores.insertAsync({
      type,
      name: user ? getUsername(user) : (stampedName ?? '(unknown)'),
      value,
      rank: i + 1,
    });
  }
}

// Games that finished before `winnerUserId` existed carry only the winner's display name.
// Resolve it from that game's own players, which is unambiguous unless two of them shared
// a name — the very collision this change is about — so skip those rather than guess.
// Anyone who left the game is unresolvable too: leaveGame deletes the Players document.
async function backfillWinnerUserIds() {
  const finished = await Games.find({
    winner: { $exists: true, $ne: 'Nobody' },
    winnerUserId: { $exists: false },
  }).fetchAsync();

  let resolved = 0;
  for (const game of finished) {
    const candidates = await Players.find({ gameId: game._id, name: game.winner }).fetchAsync();
    if (candidates.length !== 1 || !candidates[0].userId) continue;
    await Games.updateAsync(game._id, { $set: { winnerUserId: candidates[0].userId } });
    resolved++;
  }

  if (finished.length) {
    console.log(`Backfilled winnerUserId for ${resolved} of ${finished.length} finished game(s)`);
  }
}

Meteor.startup(async () => {
  await backfillWinnerUserIds();
  await buildHighscores();
});
