const deck = {};

export const Deck = new Meteor.Collection('deck', {
  transform: function (doc) {
    const newInstance = Object.create(deck);
    return Object.assign(newInstance, doc);
  },
});

Deck.allow({
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

// Milestone 2 shim — drop once every reader imports `Deck` directly.
globalThis.Deck = Deck;
