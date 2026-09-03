import { Mongo } from 'meteor/mongo';
import { ID } from 'meteor/jam:easy-schema';
import type { Doc } from '../both/schemas/infer.ts';

// One document per player per game, holding the two card lists the board never shows in
// full: the hand dealt this round, and the five chosen registers. The public copy in
// `Players.cards` carries the CardLogic.COVERED sentinel instead, which is why this
// collection exists at all and why the publication filters on `userId`.
//
// Every field is required. There is one insert site — `joinGame` — and it writes all
// five; everything after that is a `$set` on `handCards`, `chosenCards` or both, plus the
// whole-document replaces in `Games.restoreSnapshotAsync`, which put a complete document
// back. No field ever arrives late, and none is ever null.
const schema = {
  _id: ID,
  gameId: String,
  playerId: String,
  // The publication filters on this, so a player only ever sees their own hand.
  userId: String,
  // Five register slots: a card id, or the CardLogic.EMPTY sentinel -1.
  chosenCards: [Number],
  // The cards dealt this round and not yet chosen. Emptied between rounds.
  handCards: [Number],
};

export type CardDoc = Doc<typeof schema>;

// `Mongo.Collection`, not the `Meteor.Collection` alias — see the note in
// collections/chat.ts for why the alias silently ignores the schema.
export const Cards = new Mongo.Collection<CardDoc>('cards', { schema });

Cards.allow({
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
