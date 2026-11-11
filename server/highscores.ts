import { getUsername } from '../both/permissions.ts';
import { setBuildHighscores } from '../both/gamestate.ts';
import { Games } from '../collections/games.ts';
import { Highscores } from '../collections/highscores.ts';
import { Players } from '../collections/players.ts';

// How many rows each list shows.
const LIST_LENGTH = 10;

/** One thing an account did, a win or a seat, and when, in epoch milliseconds, if known. */
interface Entry {
  userId: string;
  at: number | undefined;
}

interface Standing {
  name: string;
  /** When the account reached each of its counts, latest first; a missing time is 0. */
  times: number[];
}

// Both lists count per account's `userId`, never per name: a username can change, and
// accounts older than the unique-username rule can share one. Two rows that look alike are
// honest; one row that merged two accounts' counts was not.
export async function buildHighscores() {
  console.log('Building Highscores');

  // `winnerUserId` is written only where there is a real winner, so its presence is the
  // whole filter: a game still in progress has none, and neither does one that ended with
  // 'Nobody'.
  //
  // A win by default — everyone else was destroyed, quit, or disconnected — counts the
  // same as reaching the last checkpoint. That is deliberate; the field records who was
  // left standing, not how.
  const wins = await Games.find(
    { winnerUserId: { $exists: true } },
    { fields: { winnerUserId: 1, stopped: 1 } }
  ).fetchAsync();
  // A seat counts from when its game was created: a player row keeps no time of its own.
  const games = await Games.find({}, { fields: { submitted: 1 } }).fetchAsync();
  const created = new Map(games.map((game) => [game._id, game.submitted]));
  const seats = await Players.find({}, { fields: { userId: 1, gameId: 1 } }).fetchAsync();
  // The name each account has now, so a renamed player's row follows them.
  const users = await Meteor.users
    .find({}, { fields: { 'profile.name': 1, emails: 1 } })
    .fetchAsync();
  const names = new Map(users.map((user) => [user._id, getUsername(user)]));

  const mostWon = standings(
    wins.flatMap((game) =>
      game.winnerUserId ? [{ userId: game.winnerUserId, at: game.stopped }] : []
    ),
    names
  );
  const mostPlayed = standings(
    seats.map((seat) => ({ userId: seat.userId, at: created.get(seat.gameId) })),
    names
  );

  await Highscores.removeAsync({});
  await addToHighscores(mostWon, 'mostWon');
  await addToHighscores(mostPlayed, 'mostPlayed');
}

// `both/gamestate.ts` ends games and needs to rebuild the lists, but cannot import a
// server-only module. Hand it the implementation instead.
setBuildHighscores(buildHighscores);

// Each account's entries, best first. An account that no longer exists drops out and the next
// one moves up; its games keep the name stamped on them.
function standings(entries: Entry[], names: Map<string, string>): Standing[] {
  const byAccount = new Map<string, Standing>();
  for (const { userId, at } of entries) {
    const name = names.get(userId);
    if (name === undefined) continue;
    const standing = byAccount.get(userId) ?? { name, times: [] };
    standing.times.push(at ?? 0);
    byAccount.set(userId, standing);
  }
  for (const standing of byAccount.values()) standing.times.sort((a, b) => b - a);
  return [...byAccount.values()].sort(firstToGetThere).slice(0, LIST_LENGTH);
}

// The higher count first. On a tie, whoever reached it first; if they reached it together, in
// one game, whoever reached the count before it first, and so on down. Then the name, so a tie
// never trades places between rebuilds. A missing time counts as long ago.
function firstToGetThere(a: Standing, b: Standing) {
  if (a.times.length !== b.times.length) return b.times.length - a.times.length;
  for (let i = 0; i < a.times.length; i++) {
    if (a.times[i] !== b.times[i]) return a.times[i] - b.times[i];
  }
  return a.name.localeCompare(b.name);
}

// `Highscores` is published to everyone including logged-out visitors, so the document
// deliberately carries the resolved name and not the userId.
async function addToHighscores(rows: Standing[], type: string) {
  for (const [index, { name, times }] of rows.entries()) {
    const reachedAt = times[0];
    await Highscores.insertAsync({
      type,
      name,
      value: times.length,
      rank: index + 1,
      ...(reachedAt > 0 ? { reachedAt } : {}),
    });
  }
}
