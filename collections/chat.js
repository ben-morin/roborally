import { Mongo } from 'meteor/mongo';
import { ID, Optional } from 'meteor/jam:easy-schema';

// Four insert sites, two shapes: the two `chatAsync` transforms plus `createGame` write a
// system line, and the `addMessage` method writes a player line. `userId` and `author`
// are exactly that difference — a system line has no author. Nothing ever updates a chat
// line; they are only inserted and, with their game, removed.
//
// `gameId` is a game's `_id`, or the string 'global' for the lobby chat.
const schema = {
  _id: ID,
  gameId: String,
  message: String,
  // Epoch milliseconds, not a Date. Predates the schema; left as it is.
  submitted: Number,
  userId: Optional(String),
  author: Optional(String),
};

// `Mongo.Collection`, not the `Meteor.Collection` alias the rest of the app grew up with:
// jam:easy-schema wraps the constructor on the `Mongo` namespace at package load, but
// the mongo package copied the unwrapped one onto `Meteor` before that. Through the alias
// the `schema` option is accepted and silently ignored — no validation, no warning.
export const Chat = new Mongo.Collection('chat', { schema });

Chat.allow({
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
