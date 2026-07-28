export const Cards = new Meteor.Collection('cards');

// Milestone 2 shim — drop once every reader imports `Cards` directly.
globalThis.Cards = Cards;

Cards.allow({
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
