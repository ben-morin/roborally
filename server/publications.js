import { Cards } from '../collections/cards.js';
import { Chat } from '../collections/chat.js';
import { Games } from '../collections/games.js';
import { Highscores } from '../collections/highscores.js';
import { Players } from '../collections/players.js';

Meteor.publish('games', function () {
  return Games.find({}, { limit: 10, sort: { submitted: -1 } });
});

Meteor.publish('chat', async function (gameId) {
  const size = Math.max(0, (await Chat.find({ gameId }).countAsync()) - 100);
  return Chat.find({ gameId }, { skip: size });
});

Meteor.publish('onlineUsers', function () {
  return Meteor.users.find({ 'status.online': true });
});

Meteor.publish('players', function (gameId) {
  return Players.find({ gameId });
});

Meteor.publish('cards', function (gameId) {
  return Cards.find({ gameId, userId: this.userId });
});

Meteor.publish('highscores', function () {
  return Highscores.find();
});
