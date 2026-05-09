Meteor.publish('games', function () {
  return Games.find({}, { limit: 10, sort: { submitted: -1 } });
});

Meteor.publish('chat', async function (gameId) {
  const size = Math.max(0, (await Chat.find({ gameId: gameId }).countAsync()) - 100);
  return Chat.find({ gameId: gameId }, { skip: size });
});

Meteor.publish('onlineUsers', function () {
  return Meteor.users.find({ 'status.online': true });
});

Meteor.publish('players', function (gameId) {
  return Players.find({ gameId: gameId });
});

Meteor.publish('cards', function (gameId) {
  return Cards.find({ gameId: gameId, userId: this.userId });
});

Meteor.publish('highscores', function () {
  return Highscores.find();
});
