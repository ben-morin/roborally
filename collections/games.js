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
