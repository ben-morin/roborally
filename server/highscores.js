buildHighscores = async function() {

  console.log('Building Highscores');

  const mostWon = await Games.rawCollection().aggregate([
    { $match: { winner: { $ne: "Nobody" } } },
    { $group: { _id: "$winner", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]).toArray();

  const mostPlayed = await Players.rawCollection().aggregate([
    { $group: { _id: "$name", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]).toArray();

  await Highscores.removeAsync({});
  await addToHighscores(mostWon, 'mostWon');
  await addToHighscores(mostPlayed, 'mostPlayed');
}

async function addToHighscores(arr, type) {
  for (let i = 0; i < arr.length; i++) {
    const { _id: name, count: value } = arr[i];
    await Highscores.insertAsync({ type, name, value, rank: i + 1 });
  }
}

Meteor.startup(async () => {
  await buildHighscores();
});
