export const Highscores = new Meteor.Collection('highscores');

// Milestone 2 shim — drop once every reader imports `Highscores` directly.
globalThis.Highscores = Highscores;

Highscores.allow({
  insert: function (userId, doc) {
    return false;
  },
  update: function (userId, doc) {
    return false;
  },
  remove: function (userId, doc) {
    return false;
  },
});
