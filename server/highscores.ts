import { getUsername } from '../both/permissions.ts';
import { setBuildHighscores } from '../both/gamestate.ts';
import { Games } from '../collections/games.ts';
import { Highscores } from '../collections/highscores.ts';
import { Players } from '../collections/players.ts';

// How many rows each list shows.
const LIST_LENGTH = 10;

// What both `$group` stages below produce. `rawCollection()` is the npm driver, so
// `aggregate<T>()` hands the rows back as `T` and this is their only description. `_id` is
// the group key; Mongo yields null for it when the field it reads is absent.
interface RankingRow {
  _id: string | null;
  count: number;
}

// Both lists group on the account's `userId`, never on a name: a username can change, and
// accounts older than the unique-username rule can share one. Two rows that look alike are
// honest; one row that merged two accounts' counts was not.
export async function buildHighscores() {
  console.log('Building Highscores');

  const mostWon = await Games.rawCollection()
    .aggregate<RankingRow>([
      // `winnerUserId` is written only where there is a real winner, so its presence is
      // the whole filter: a game still in progress has none, and neither does one that
      // ended with 'Nobody'.
      //
      // A win by default — everyone else was destroyed, quit, or disconnected — counts the
      // same as reaching the last checkpoint. That is deliberate; the field records who
      // was left standing, not how.
      { $match: { winnerUserId: { $exists: true } } },
      { $group: { _id: '$winnerUserId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  const mostPlayed = await Players.rawCollection()
    .aggregate<RankingRow>([
      { $group: { _id: '$userId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  await Highscores.removeAsync({});
  await addToHighscores(mostWon, 'mostWon');
  await addToHighscores(mostPlayed, 'mostPlayed');
}

// `both/gamestate.ts` ends games and needs to rebuild the lists, but cannot import a
// server-only module. Hand it the implementation instead.
setBuildHighscores(buildHighscores);

// The name comes from the account as it is now, so a renamed player's row follows them.
// A deleted account drops out, and the next one moves up: the pipelines above have no
// `$limit` so that the list stays full. Its games keep the name stamped on them.
//
// `Highscores` is published to everyone including logged-out visitors, so the document
// deliberately carries the resolved name and not the userId.
async function addToHighscores(rows: RankingRow[], type: string) {
  let rank = 0;
  for (const { _id: userId, count: value } of rows) {
    if (rank === LIST_LENGTH) return;
    const user = userId
      ? await Meteor.users.findOneAsync(userId, { fields: { 'profile.name': 1, emails: 1 } })
      : undefined;
    if (!user) continue;
    rank += 1;
    await Highscores.insertAsync({ type, name: getUsername(user), value, rank });
  }
}
