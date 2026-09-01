import { Mongo } from 'meteor/mongo';
import { ID } from 'meteor/jam:easy-schema';

const deck = {
  // Persist this deck back as a whole document, the way every deck write already worked
  // before the schema — the caller mutates `cards` in place and saves once.
  //
  // Two things here are load-bearing, not tidiness:
  //
  // The spread, for the same reason as `player.saveAsync`: the transform hands out
  // `Object.create(deck)`, and the schema check refuses anything whose prototype is not
  // `Object.prototype` with a bare 'Expected plain object'. Own enumerable properties are
  // exactly the document's fields, so the copy is the document and nothing else.
  //
  // The upsert, because a deck read through `game.getDeckAsync()` may never have been
  // written: the first deal of a game builds one with `newDeck` and no `_id` yet. Keying
  // on `gameId` covers both — replace the one deck this game has, or create it.
  async saveAsync() {
    return await Deck.upsertAsync({ gameId: this.gameId }, { ...this });
  },
};

// A deck that has not been saved yet. It has to carry the prototype so that the very
// first save goes through `saveAsync` like every later one, which is what lets
// `getDeckAsync` promise its callers a single shape.
export const newDeck = (fields) => Object.assign(Object.create(deck), fields);

// One document per game. Every field is required and none arrives late: `newDeck` writes
// all four, and every write after that is this whole document going back.
const schema = {
  _id: ID,
  gameId: String,
  // The draw pile: 84 card ids for up to 8 players, 126 otherwise. Cards are taken out
  // when dealt and pushed back when discarded, so this is the whole deck minus the hands.
  cards: [Number],
  optionCards: [Number],
  discardedOptionCards: [Number],
};

// `Mongo.Collection`, not the `Meteor.Collection` alias — see the note in
// collections/chat.js for why the alias silently ignores the schema.
export const Deck = new Mongo.Collection('deck', {
  schema,
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
