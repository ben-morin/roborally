import { setBuildHighscores } from '../both/gamestate.js';
import { Games } from '../collections/games.js';
import { Highscores } from '../collections/highscores.js';
import { Players } from '../collections/players.js';

export async function buildHighscores() {
  console.log('Building Highscores');

  const mostWon = await Games.rawCollection()
    .aggregate([
      // `$exists` is load-bearing: on its own, `{$ne: 'Nobody'}` also matches every game
      // that has no `winner` yet, which would group all games in progress under a single
      // `_id: null` bucket and rank that nameless entry alongside real winners.
      //
      // 'Nobody' is the only excluded outcome. A win by default — everyone else was
      // destroyed, quit, or disconnected — counts the same as reaching the last
      // checkpoint. That is deliberate; `winner` records who was left standing, not how.
      { $match: { winner: { $exists: true, $ne: 'Nobody' } } },
      { $group: { _id: '$winner', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ])
    .toArray();

  const mostPlayed = await Players.rawCollection()
    .aggregate([
      { $group: { _id: '$name', count: { $sum: 1 } } },
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

async function addToHighscores(arr, type) {
  for (const [i, { _id: name, count: value }] of arr.entries()) {
    await Highscores.insertAsync({ type, name, value, rank: i + 1 });
  }
}

Meteor.startup(async () => {
  await buildHighscores();
});
