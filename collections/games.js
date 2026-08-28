import { BoardBox } from '../both/board_box.js';
import { CardLogic } from '../both/cardlogic.js';
import { GameLogic } from '../both/gamelogic.js';
import { GameState } from '../both/gamestate.js';
import { ownsDocument } from '../both/permissions.js';
import { shuffle } from '../both/shuffle.js';
import { Chat } from './chat.js';
import { Deck } from './deck.js';
import { Players } from './players.js';

// [0, 1, ... count - 1] — the card ids of a full deck.
function indices(count) {
  return Array.from({ length: count }, (_, i) => i);
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
    const modified = await Games.updateAsync(
      { _id: this._id, step: this.step },
      { ...modifier, $set, $inc: { ...(modifier.$inc ?? {}), step: 1 } }
    );
    if (modified === 0) return false;
    this.step += 1;
    Object.assign(this, $set);
    return true;
  },
  async nextPlayPhaseAsync(phase) {
    if (phase != null) {
      await this.setPlayPhaseAsync(phase);
    }
    return await GameState.nextPlayPhaseAsync(this._id);
  },
  async nextGamePhaseAsync(phase) {
    if (phase != null) {
      await this.setGamePhaseAsync(phase);
    }
    return await GameState.nextGamePhaseAsync(this._id);
  },
  async nextRespawnPhaseAsync(phase) {
    if (phase != null) {
      await this.setRespawnPhaseAsync(phase);
    }
    return await GameState.nextRespawnPhaseAsync(this._id);
  },
  async setPlayPhaseAsync(phase) {
    return await Games.updateAsync(this._id, {
      $set: {
        playPhase: phase,
      },
    });
  },
  async setGamePhaseAsync(phase) {
    return await Games.updateAsync(this._id, {
      $set: {
        gamePhase: phase,
      },
    });
  },
  async setRespawnPhaseAsync(phase) {
    return await Games.updateAsync(this._id, {
      $set: {
        respawnPhase: phase,
      },
    });
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
    return await Games.updateAsync(this._id, {
      $set: {
        announce: true,
      },
    });
  },
  async stopAnnounceAsync() {
    return await Games.updateAsync(this._id, {
      $set: {
        announce: false,
      },
    });
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
