const deck = {};

export const Deck = new Meteor.Collection('deck', {
  transform(doc) {
    const newInstance = Object.create(deck);
    return Object.assign(newInstance, doc);
  },
});

Deck.allow({
  insert(_userId, _doc) {
    return false;
  },
  update(_userId, _doc) {
    return false;
  },
  remove(_userId, _doc) {
    return false;
  },
});
