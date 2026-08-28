import { BoardBox } from '../both/board_box.js';
import { CardLogic } from '../both/cardlogic.js';
import { GameLogic } from '../both/gamelogic.js';
import { GameState } from '../both/gamestate.js';
import { ownsDocument } from '../both/permissions.js';
import { shuffle } from '../both/shuffle.js';
import { Cards } from './cards.js';
import { Chat } from './chat.js';
import { Deck } from './deck.js';
import { Players } from './players.js';

// [0, 1, ... count - 1] — the card ids of a full deck.
function indices(count) {
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
//
// Evaluated at call time, never at load: `GameState` sits on the other side of an import
// cycle with this module.
function isSegmentEntry(phase) {
  return phase === GameState.PHASE.DEAL || phase === GameState.PHASE.PLAY;
}

// Own fields only — the collection transforms put their methods on the prototype.
function plain(doc) {
  return { ...doc };
}

async function takeSnapshotAsync(game, segment) {
  const players = (await Players.find({ gameId: game._id }).fetchAsync()).map(plain);
  const cards = (await Cards.find({ gameId: game._id }).fetchAsync()).map(plain);
  const deck = await Deck.findOneAsync({ gameId: game._id });
  return { segment, takenAt: new Date(), players, cards, deck: deck ? plain(deck) : null };
}

const game = {
  board() {
    return BoardBox.getBoard(this.boardId);
  },
  async playersAsync() {
    return await Players.find({ gameId: this._id }).fetchAsync();
  },
  playerCnt() {
    return Players.find({ gameId: this._id }).count();
  },
  async playerCntAsync() {
    return await Players.find({ gameId: this._id }).countAsync();
  },
  async isPlayerOnTileAsync(x, y) {
    let found = null;
    const players = await this.playersAsync();
    for (const player of players) {
      if (player.position.x === x && player.position.y === y) {
        found = player;
      }
    }
    return found;
  },
  async chatAsync(msg, debug_info) {
    await Chat.insertAsync({
      gameId: this._id,
      message: msg,
      submitted: new Date().getTime(),
    });
    if (debug_info != null) {
      msg += ` ${debug_info}`;
    }
    console.log(msg);
  },
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
  async advanceAsync(modifier = {}) {
    const $set = { ...(modifier.$set ?? {}), lastStepAt: new Date() };
    // Entering a segment: the claim carries the snapshot of this very moment, so no call
    // site has to remember to take one — none of the three DEAL entries can forget it.
    if (isSegmentEntry($set.gamePhase)) {
      $set.segmentSnapshot = await takeSnapshotAsync(this, $set.gamePhase);
    }
    const $inc = { ...(modifier.$inc ?? {}), step: 1 };
    const modified = await Games.updateAsync(
      { _id: this._id, step: this.step },
      { ...modifier, $set, $inc }
    );
    if (modified === 0) return false;
    Object.assign(this, $set);
    for (const [field, by] of Object.entries($inc)) this[field] = (this[field] ?? 0) + by;
    return true;
  },
  // Put players, cards and deck back to where the current segment started. Whole-document
  // writes, so a field the crashed run added is gone again too. A document that no longer
  // exists (a player who left mid-turn) is skipped, never re-inserted. When the segment
  // started with no deck at all — the very first deal — any deck the crashed run created is
  // removed, so the replayed deal builds a fresh full one instead of dealing from a deck
  // that already handed out cards the restored hands no longer hold.
  async restoreSnapshotAsync() {
    const snapshot = this.segmentSnapshot;
    for (const doc of snapshot.players) {
      if (!(await Players.findOneAsync(doc._id))) continue;
      const { _id, ...fields } = doc;
      await Players.updateAsync(_id, fields);
    }
    for (const doc of snapshot.cards) {
      if (!(await Cards.findOneAsync(doc._id))) continue;
      const { _id, ...fields } = doc;
      await Cards.updateAsync(_id, fields);
    }
    if (snapshot.deck) {
      const { _id, ...fields } = snapshot.deck;
      if (await Deck.findOneAsync(_id)) await Deck.updateAsync(_id, fields);
    } else {
      await Deck.removeAsync({ gameId: this._id });
    }
  },
  // The `phase` argument is itself a claim: when it loses, another driver owns the game
  // and this one stops here instead of dispatching a phase it no longer holds.
  async nextPlayPhaseAsync(phase) {
    if (phase != null && !(await this.setPlayPhaseAsync(phase))) return;
    return await GameState.nextPlayPhaseAsync(this._id);
  },
  async nextGamePhaseAsync(phase) {
    if (phase != null && !(await this.setGamePhaseAsync(phase))) return;
    return await GameState.nextGamePhaseAsync(this._id);
  },
  async nextRespawnPhaseAsync(phase) {
    if (phase != null && !(await this.setRespawnPhaseAsync(phase))) return;
    return await GameState.nextRespawnPhaseAsync(this._id);
  },
  // Each of these resolves to the claim's boolean — `false` means stop.
  async setPlayPhaseAsync(phase) {
    return await this.advanceAsync({ $set: { playPhase: phase } });
  },
  async setGamePhaseAsync(phase) {
    return await this.advanceAsync({ $set: { gamePhase: phase } });
  },
  async setRespawnPhaseAsync(phase) {
    return await this.advanceAsync({ $set: { respawnPhase: phase } });
  },
  async getDeckAsync() {
    const existingDeck = await Deck.findOneAsync({ gameId: this._id });
    if (existingDeck) {
      return existingDeck;
    }
    return await this.newDeckAsync();
  },
  async newDeckAsync() {
    const cnt = await this.playerCntAsync();
    const deckSpec = cnt <= 8 ? CardLogic._8_deck : CardLogic._12_deck;
    const deckSize = deckSpec.reduce((total, cardTypeCnt) => total + cardTypeCnt, 0);
    return {
      gameId: this._id,
      cards: indices(deckSize),
      optionCards: shuffle(indices(CardLogic._option_deck.length)),
      discardedOptionCards: [],
    };
  },
  async startAnnounceAsync() {
    return await this.advanceAsync({ $set: { announce: true } });
  },
  async stopAnnounceAsync() {
    return await this.advanceAsync({ $set: { announce: false } });
  },
  async activePlayersAsync() {
    return await Players.find({
      gameId: this._id,
      needsRespawn: false,
      lives: { $gt: 0 },
      powerState: { $ne: GameLogic.OFF },
    }).fetchAsync();
  },
  async livingPlayersAsync() {
    return await Players.find({
      gameId: this._id,
      lives: { $gt: 0 },
    }).fetchAsync();
  },
  async playersOnBoardAsync() {
    return await Players.find({
      gameId: this._id,
      needsRespawn: false,
      lives: { $gt: 0 },
    }).fetchAsync();
  },
};

export const Games = new Meteor.Collection('games', {
  transform(doc) {
    const newInstance = Object.create(game);
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
    return ownsDocument(userId, doc);
  },
});
