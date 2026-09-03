import { Mongo } from 'meteor/mongo';
import { Any, AnyOf, ID, Optional } from 'meteor/jam:easy-schema';
import { BoardBox } from '../both/board_box.ts';
import { CardLogic } from '../both/cardlogic.ts';
import { Null } from '../both/easySchemaConfig.ts';
import { GameLogic } from '../both/gamelogic.ts';
import { GameState } from '../both/gamestate.ts';
import { ownsDocument } from '../both/permissions.ts';
import type { Doc, UpdateModifier } from '../both/schemas/infer.ts';
import { shuffle } from '../both/shuffle.ts';
import { Cards, type CardDoc } from './cards.ts';
import { Chat } from './chat.ts';
import { Decks, newDeck, type DeckDoc } from './deck.ts';
import { Players, type Player, type PlayerDoc } from './players.ts';

// [0, 1, ... count - 1] — the card ids of a full deck.
function indices(count: number) {
  return Array.from({ length: count }, (_, i) => i);
}

// ---------------------------------------------------------------------------
// Segment snapshots
// ---------------------------------------------------------------------------
//
// A segment is a stretch of server-driven steps with no human input inside it. A turn has
// two: play (every card in → five registers → repairs) and deal. The claim that enters a
// segment — any `$set` of `gamePhase` to PLAY or DEAL — stores the players, cards and deck
// as they are at that moment on the game document itself, and `GameState.resumeAsync` puts
// them back before it runs the segment again from its first step. That is what lets the
// handlers stay as they are: nothing inside a segment has to be idempotent.
//
// The snapshot is the whole of all three collections, the same in both segments. Nothing a
// player can do from the UI touches a player document while a segment runs — the power-down
// button and the card slots are only live before that player has submitted, and every
// living player has submitted before play starts — so there is nothing a restore could undo
// that it should not.

// What the `segmentSnapshot` field really holds. The schema says `Any` there on purpose
// (see the field's own comment below), so this interface — not the schema — is where the
// shape is written down, and `restoreSnapshotAsync` is the one place it is asserted.
export interface SegmentSnapshot {
  segment: string;
  takenAt: Date;
  players: PlayerDoc[];
  cards: CardDoc[];
  deck: DeckDoc | null;
}

// Evaluated at call time, never at load: `GameState` sits on the other side of an import
// cycle with this module.
//
// The predicate is what lets `takeSnapshotAsync` take a plain `string` for its segment; it
// cannot promise more than `string` because the phase value domains are still a later
// tightening pass.
function isSegmentEntry(phase: string | undefined): phase is string {
  return phase === GameState.PHASE.DEAL || phase === GameState.PHASE.PLAY;
}

// Own fields only — the collection transforms put their methods on the prototype.
function plain<T extends object>(doc: T): T {
  return { ...doc };
}

async function takeSnapshotAsync(game: GameDoc, segment: string): Promise<SegmentSnapshot> {
  const players = (await Players.find({ gameId: game._id }).fetchAsync()).map(plain);
  const cards = (await Cards.find({ gameId: game._id }).fetchAsync()).map(plain);
  const deck = await Decks.findOneAsync({ gameId: game._id });
  return { segment, takenAt: new Date(), players, cards, deck: deck ? plain(deck) : null };
}

// The document's fields and the transform's methods, merged: the interface carries the
// fields so `this` is typed inside the class, and `Object.create(Game.prototype)` below is
// what joins the two at runtime — the same prototype-not-constructor shape as before.
// `GameDoc` is declared with the schema further down, where the fields are.
export interface Game extends GameDoc {}
export class Game {
  board() {
    return BoardBox.getBoard(this.boardId);
  }
  async playersAsync() {
    return await Players.find({ gameId: this._id }).fetchAsync();
  }
  playerCnt() {
    return Players.find({ gameId: this._id }).count();
  }
  async playerCntAsync() {
    return await Players.find({ gameId: this._id }).countAsync();
  }
  async isPlayerOnTileAsync(x: number, y: number) {
    let found: Player | null = null;
    const players = await this.playersAsync();
    for (const player of players) {
      if (player.position.x === x && player.position.y === y) {
        found = player;
      }
    }
    return found;
  }
  async chatAsync(msg: string, debug_info?: string | number) {
    await Chat.insertAsync({
      gameId: this._id,
      message: msg,
      submitted: new Date().getTime(),
    });
    if (debug_info != null) {
      msg += ` ${debug_info}`;
    }
    console.log(msg);
  }
  // The compare-and-set that every write in the turn chain goes through. The selector
  // pins the game's `step`, so the write lands only if nothing else has advanced the game
  // since this instance was read, and `$inc: { step: 1 }` guarantees the update actually
  // modifies the document — Meteor's `updateAsync` resolves to a modifiedCount, so a write
  // that changed nothing is indistinguishable from one that matched nothing.
  //
  // `false` means another driver owns the game now. That is a normal outcome, not an
  // error: the caller returns and lets the winner carry on. `true` leaves this instance
  // current with what was written, so the caller can keep using it.
  //
  // Every game document carries `step` — seeded by createGame, backfilled at startup for
  // games already in flight — because a selector on a missing field can never match.
  // `$set` paths are plain field names for the same reason the instance is updated with a
  // bare Object.assign: nothing in the chain sets a dotted path.
  async advanceAsync(modifier: UpdateModifier<GameDoc> = {}) {
    const $set: Partial<GameDoc> = { ...(modifier.$set ?? {}), lastStepAt: new Date() };
    // Entering a segment: the claim carries the snapshot of this very moment, so no call
    // site has to remember to take one — none of the three DEAL entries can forget it.
    if (isSegmentEntry($set.gamePhase)) {
      $set.segmentSnapshot = await takeSnapshotAsync(this, $set.gamePhase);
    }
    const $inc: Record<string, number> = { ...(modifier.$inc ?? {}), step: 1 };
    const modified = await Games.updateAsync(
      { _id: this._id, step: this.step },
      { ...modifier, $set, $inc }
    );
    if (modified === 0) return false;
    Object.assign(this, $set);
    // The `$inc` keys are field names chosen by the call site, so the instance is updated
    // through a numeric view of itself: indexing `Game` by a plain string is not typed,
    // and the union `GameDoc[keyof GameDoc]` has no `+`.
    const counters = this as unknown as Record<string, number | undefined>;
    for (const [field, by] of Object.entries($inc)) counters[field] = (counters[field] ?? 0) + by;
    return true;
  }
  // Put players, cards and deck back to where the current segment started. Whole-document
  // writes, so a field the crashed run added is gone again too. A document that no longer
  // exists (a player who left mid-turn) is skipped, never re-inserted. When the segment
  // started with no deck at all — the very first deal — any deck the crashed run created is
  // removed, so the replayed deal builds a fresh full one instead of dealing from a deck
  // that already handed out cards the restored hands no longer hold.
  async restoreSnapshotAsync() {
    // The one place the snapshot's shape is asserted rather than derived, because the
    // schema says `Any` on the field on purpose. Not `| undefined`: the only caller,
    // `GameState.resumeAsync`, checks the snapshot is there and matches the phase first.
    const snapshot = this.segmentSnapshot as SegmentSnapshot;
    for (const doc of snapshot.players) {
      if (!(await Players.findOneAsync(doc._id))) continue;
      const { _id, ...fields } = doc;
      // A replacement leaves `_id` out — Mongo refuses to change it — and `Modifier<T>`
      // knows only "the whole document" or "$-operators", nothing in between.
      await Players.updateAsync(_id, fields as PlayerDoc);
    }
    for (const doc of snapshot.cards) {
      if (!(await Cards.findOneAsync(doc._id))) continue;
      const { _id, ...fields } = doc;
      // The same `_id`-less replacement as above.
      await Cards.updateAsync(_id, fields as CardDoc);
    }
    if (snapshot.deck) {
      const { _id, ...fields } = snapshot.deck;
      // And again, for the one deck.
      if (await Decks.findOneAsync(_id)) await Decks.updateAsync(_id, fields as DeckDoc);
    } else {
      await Decks.removeAsync({ gameId: this._id });
    }
  }
  // The `phase` argument is itself a claim: when it loses, another driver owns the game
  // and this one stops here instead of dispatching a phase it no longer holds.
  //
  // Each dispatch reads `GameState` at call time, never at load — it is on the other side
  // of an import cycle with this module.
  async nextPlayPhaseAsync(phase?: string) {
    if (phase != null && !(await this.setPlayPhaseAsync(phase))) return;
    return await GameState.nextPlayPhaseAsync(this._id);
  }
  async nextGamePhaseAsync(phase?: string) {
    if (phase != null && !(await this.setGamePhaseAsync(phase))) return;
    return await GameState.nextGamePhaseAsync(this._id);
  }
  async nextRespawnPhaseAsync(phase?: string) {
    if (phase != null && !(await this.setRespawnPhaseAsync(phase))) return;
    return await GameState.nextRespawnPhaseAsync(this._id);
  }
  // Each of these resolves to the claim's boolean — `false` means stop.
  async setPlayPhaseAsync(phase: string) {
    return await this.advanceAsync({ $set: { playPhase: phase } });
  }
  async setGamePhaseAsync(phase: string) {
    return await this.advanceAsync({ $set: { gamePhase: phase } });
  }
  async setRespawnPhaseAsync(phase: string) {
    return await this.advanceAsync({ $set: { respawnPhase: phase } });
  }
  async getDeckAsync() {
    const existingDeck = await Decks.findOneAsync({ gameId: this._id });
    if (existingDeck) {
      return existingDeck;
    }
    return await this.newDeckAsync();
  }
  async newDeckAsync() {
    const cnt = await this.playerCntAsync();
    const deckSpec = cnt <= 8 ? CardLogic._8_deck : CardLogic._12_deck;
    const deckSize = deckSpec.reduce((total, cardTypeCnt) => total + cardTypeCnt, 0);
    // `newDeck`, not a bare object literal: an unsaved deck has to carry the same
    // prototype as a stored one so `getDeckAsync` hands every caller one shape, with
    // `saveAsync` on it either way.
    return newDeck({
      gameId: this._id,
      cards: indices(deckSize),
      optionCards: shuffle(indices(CardLogic._option_deck.length)),
      discardedOptionCards: [],
    });
  }
  async startAnnounceAsync() {
    return await this.advanceAsync({ $set: { announce: true } });
  }
  async stopAnnounceAsync() {
    return await this.advanceAsync({ $set: { announce: false } });
  }
  async activePlayersAsync() {
    return await Players.find({
      gameId: this._id,
      needsRespawn: false,
      lives: { $gt: 0 },
      powerState: { $ne: GameLogic.OFF },
    }).fetchAsync();
  }
  async livingPlayersAsync() {
    return await Players.find({
      gameId: this._id,
      lives: { $gt: 0 },
    }).fetchAsync();
  }
  async playersOnBoardAsync() {
    return await Players.find({
      gameId: this._id,
      needsRespawn: false,
      lives: { $gt: 0 },
    }).fetchAsync();
  }
}

// The whole game document, not just what `createGame` inserts: the block above the divider
// is the insert literal, and everything below it arrives later through a `$set` — usually
// through `advanceAsync`. Both halves have to be here, because a snapshot restore writes
// player, card and deck documents whole and `advanceAsync` validates every modifier it
// builds; a field the schema does not name is refused by the database validator, which
// generates `additionalProperties: false`.
//
// `AnyOf(X, Null)` means the key is there and its value may be null. `Optional(X)` means
// the key may be missing. Nothing here says `Optional(AnyOf(X, Null))`: five fields used
// to, which gave them three states — absent, null, or a value — where every reader means
// two. `createGame` seeds them null and the startup backfill in server/cron.ts fills them
// in on games that predate that, so "absent" is no longer reachable.
//
// `winnerUserId` is the one deliberate exception: it is absent when there is no winner and
// never null, because server/highscores.ts counts wins with an `$exists` filter.
const schema = {
  _id: ID,
  name: String,
  userId: String,
  author: String,
  // Epoch milliseconds, like Chat's. Not a Date.
  submitted: Number,
  started: Boolean,
  // GameState.PHASE.* / PLAY_PHASE.* / RESPAWN_PHASE.* — plain strings for now; the value
  // domains are a later tightening pass.
  gamePhase: String,
  playPhase: String,
  respawnPhase: String,
  // The register counter, 1..5.
  playPhaseCount: Number,
  programRound: Number,
  boardId: Number,
  min_player: Number,
  max_player: Number,
  // Player _ids, popped one at a time by the respawn phase.
  waitingForRespawn: [String],
  announce: Boolean,
  // This register's cards, highest priority first; shifted empty as they play.
  cardsToPlay: [{ cardId: Number, playerId: String }],
  // The compare-and-set counter. Null at insert and in the startup backfill, so the very
  // first claim has something to compare against. See `advanceAsync` above.
  step: Number,
  lastStepAt: AnyOf(Date, Null),
  // Null until the programming timer is armed, and back to null when it stops.
  timerStartedAt: AnyOf(Date, Null),
  // Whose robot the respawn phase is placing, and who gets to place it.
  respawnPlayerId: AnyOf(String, Null),
  respawnUserId: AnyOf(String, Null),
  // Respawn tiles offered to the player. `dir` only in the choose-direction round.
  selectOptions: AnyOf([{ x: Number, y: Number, dir: Optional(Number) }], Null),
  // The card currently being announced, one at a time as a register plays.
  announceCard: AnyOf({ cardId: Number, playerId: String }, Null),
  // --- everything below arrives later, through a $set ---
  //
  // Verbatim copies of Players, Cards and Decks documents, each already validated by its own
  // collection, and projected out of the games publication. Describing the nested shape
  // again here would mean keeping three other schemas in sync forever. `SegmentSnapshot`
  // above is the type-level description.
  segmentSnapshot: Optional(Any),
  // The programming timer: -1 off, 1 running, 0 expired. Absent until the first deal, so
  // unlike `timerStartedAt` above it is genuinely two-state.
  timer: Optional(Number),
  // A display name, or the 'Nobody' sentinel when a game ends with no winner.
  winner: Optional(String),
  winnerUserId: Optional(String),
  // Epoch milliseconds again.
  stopped: Optional(Number),
};

export type GameDoc = Doc<typeof schema>;

// `Mongo.Collection` rather than the `Meteor.Collection` alias — see the note in
// collections/chat.ts for why the alias silently ignores the schema.
export const Games = new Mongo.Collection<GameDoc, Game>('games', {
  schema,
  transform(doc) {
    const newInstance = Object.create(Game.prototype);
    return Object.assign(newInstance, doc);
  },
});

Games.allow({
  insert(_userId, _doc) {
    return false;
  },
  update(_userId, _doc) {
    return false;
  },
  remove(userId, doc) {
    // `ownsDocument` is written `doc && doc.userId === userId`, so it hands back the
    // document's own falsy value when there is no document, not `false`. Same denial
    // either way; `Boolean` is only what makes it the boolean `allow` declares.
    return Boolean(ownsDocument(userId, doc));
  },
});
