/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * DS208: Avoid top-level this
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
import { BoardBox } from '../both/board_box.js';
import { CardLogic } from '../both/cardlogic.js';
import { GameLogic } from '../both/gamelogic.js';
import { GameState } from '../both/gamestate.js';
import { ownsDocument } from '../both/permissions.js';
import { shuffle } from '../both/shuffle.js';
import { Chat } from './chat.js';
import { Deck } from './deck.js';
import { Players } from './players.js';

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
    for (const player of Array.from(players)) {
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
      msg += ' ' + debug_info;
    }
    return console.log(msg);
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
    let deckSize = 0;
    for (const cardTypeCnt of Array.from(deckSpec)) {
      deckSize += cardTypeCnt;
    }
    return {
      gameId: this._id,
      cards: __range__(0, deckSize - 1, true),
      optionCards: shuffle(__range__(0, CardLogic._option_deck.length - 1, true)),
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

// Milestone 2 shim — drop once every reader imports `Games` directly.
globalThis.Games = Games;

Games.allow({
  insert(userId, doc) {
    return false;
  },
  update(userId, doc) {
    return false;
  },
  remove(userId, doc) {
    return ownsDocument(userId, doc);
  },
});

function __range__(left, right, inclusive) {
  const range = [];
  const ascending = left < right;
  const end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
