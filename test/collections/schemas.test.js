// The shape-drift tripwire.
//
// The vitest stub for jam:easy-schema validates nothing on purpose (see
// test/stubs/jam-easy-schema.js for why a rejection cannot be proven out here). What a
// test in this suite *can* prove is the declared shape: which fields each collection
// says exist, and which of them may be absent. So every field added to or dropped from a
// schema has to be written down twice — once in the collection, once in EXPECTED below —
// and a change made in only one place fails here.
import { describe, expect, it } from 'vitest';
import { AnyOf, Optional } from 'meteor/jam:easy-schema';
import { Cards } from '../../collections/cards.ts';
import { Chat } from '../../collections/chat.ts';
import { Decks } from '../../collections/deck.ts';
import { Games } from '../../collections/games.ts';
import { Highscores } from '../../collections/highscores.ts';
import { Players } from '../../collections/players.ts';

const COLLECTIONS = { Cards, Chat, Decks, Games, Highscores, Players };

// name -> { required, optional }. Each collection lands here in the commit that attaches
// its schema, so a collection missing from this table has no schema attached yet.
const EXPECTED = {
  Cards: {
    // Every field, every time: one insert site writes all five, and nothing arrives late.
    required: ['_id', 'gameId', 'playerId', 'userId', 'chosenCards', 'handCards'],
    optional: [],
  },
  Chat: {
    required: ['_id', 'gameId', 'message', 'submitted'],
    // A system line has no author; only the `addMessage` method writes these two.
    optional: ['userId', 'author'],
  },
  Decks: {
    // `newDeck` writes all four; every write after that is the whole document going back.
    required: ['_id', 'gameId', 'cards', 'optionCards', 'discardedOptionCards'],
    optional: [],
  },
  Games: {
    // Exactly what `createGame` inserts, plus `_id`.
    required: [
      '_id',
      'name',
      'userId',
      'author',
      'submitted',
      'started',
      'gamePhase',
      'playPhase',
      'respawnPhase',
      'playPhaseCount',
      'programRound',
      'boardId',
      'min_player',
      'max_player',
      'waitingForRespawn',
      'announce',
      'cardsToPlay',
      'step',
      'lastStepAt',
      'timerStartedAt',
      'respawnPlayerId',
      'respawnUserId',
      'selectOptions',
      'announceCard',
    ],
    // Everything a later `$set` adds. A game that never reaches these phases never grows
    // the keys, so none of them can be required.
    optional: ['segmentSnapshot', 'timer', 'winner', 'winnerUserId', 'stopped'],
  },
  Players: {
    // Exactly what `joinGame` inserts, plus `_id`.
    required: [
      '_id',
      'gameId',
      'userId',
      'name',
      'lives',
      'damage',
      'visited_checkpoints',
      'needsRespawn',
      'powerState',
      'optionalInstantPowerDown',
      'position',
      'chosenCardsCnt',
      'optionCards',
      'cards',
      'ablativeCoat',
    ],
    // Added once the game starts, or later still. A player who joins a game that never
    // starts never grows any of them.
    optional: ['direction', 'robotId', 'start', 'submitted', 'playedCardsCnt', 'shotDistance'],
  },
  Highscores: {
    // Rebuilt wholesale each time, so a row is always complete.
    required: ['_id', 'type', 'name', 'value', 'rank'],
    optional: [],
  },
};

// Only `Optional(...)` makes a key absent-able; `AnyOf(X, Null)` keeps the key required
// and merely lets its value be null. The stub tags the first with __optional, which is
// the whole reason it returns markers instead of the real package's internals.
const isOptional = (type) => typeof type === 'object' && type !== null && '__optional' in type;

const keysOf = (schema, optional) =>
  Object.entries(schema)
    .filter(([, type]) => isOptional(type) === optional)
    .map(([key]) => key)
    .sort();

describe('collection schemas', () => {
  it('tells Optional apart from AnyOf and from a plain type', () => {
    expect(isOptional(Optional(String))).toBe(true);
    expect(isOptional(AnyOf(String, null))).toBe(false);
    expect(isOptional(String)).toBe(false);
    expect(isOptional([Number])).toBe(false);
  });

  // Catches the other direction: a schema attached to a collection nobody added to
  // EXPECTED would otherwise be checked by nothing at all.
  it('lists every collection that carries a schema', () => {
    const attached = Object.keys(COLLECTIONS)
      .filter((name) => COLLECTIONS[name].schema)
      .sort();
    expect(attached).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    describe(name, () => {
      it('requires exactly the expected keys', () => {
        expect(keysOf(COLLECTIONS[name].schema, false)).toEqual([...expected.required].sort());
      });

      it('makes exactly the expected keys optional', () => {
        expect(keysOf(COLLECTIONS[name].schema, true)).toEqual([...expected.optional].sort());
      });
    });
  }
});
