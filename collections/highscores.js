import { Mongo } from 'meteor/mongo';
import { ID } from 'meteor/jam:easy-schema';

// The ranking lists, rebuilt from scratch every hour and whenever a game ends: the whole
// collection is removed and re-inserted, so there is one insert site and no update site
// at all. Every field is required.
//
// Published to logged-out visitors too, which is why a row carries the resolved display
// name rather than the userId it was grouped by.
const schema = {
  _id: ID,
  // 'mostWon' or 'mostPlayed' — the two lists share this collection.
  type: String,
  // The display name at rebuild time, or the '(unknown)' fallback.
  name: String,
  // Games won, or games played.
  value: Number,
  // 1..10, the position in its own list.
  rank: Number,
};

// `Mongo.Collection`, not the `Meteor.Collection` alias — see the note in
// collections/chat.js for why the alias silently ignores the schema.
export const Highscores = new Mongo.Collection('highscores', { schema });

Highscores.allow({
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
