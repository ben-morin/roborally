import { CardLogic } from '../both/cardlogic.js';
import { GameLogic } from '../both/gamelogic.js';
import { Tile } from '../both/tile.js';
import { Cards } from './cards.js';
import { Chat } from './chat.js';
import { Deck } from './deck.js';
import { Games } from './games.js';

const player = {
  game() {
    return Games.findOne(this.gameId);
  },
  async gameAsync() {
    return Games.findOneAsync(this.gameId);
  },
  board() {
    return Games.findOne(this.gameId).board();
  },
  async boardAsync() {
    const game = await Games.findOneAsync(this.gameId);
    return game.board();
  },
  tile() {
    return this.board().getTile(this.position.x, this.position.y);
  },
  async tileAsync() {
    const board = await this.boardAsync();
    return board.getTile(this.position.x, this.position.y);
  },
  getHandCards() {
    const c = Cards.findOne({ playerId: this._id });
    return c ? c.handCards : [];
  },
  async getHandCardsAsync() {
    const c = await Cards.findOneAsync({ playerId: this._id });
    return c ? c.handCards : [];
  },
  getChosenCards() {
    const c = Cards.findOne({ playerId: this._id });
    return c ? c.chosenCards : [];
  },
  async getChosenCardsAsync() {
    const c = await Cards.findOneAsync({ playerId: this._id });
    return c ? c.chosenCards : [];
  },
  hasOptionCard(optionName) {
    return this.optionCards[optionName];
  },
  async updateHandCardsAsync(cards) {
    await Cards.upsertAsync({ playerId: this._id }, { $set: { handCards: cards } });
  },
  async chooseCardAsync(card, index) {
    const cards = await this.getChosenCardsAsync();
    let inc = 0;
    if (cards[index] === CardLogic.EMPTY) inc = 1;
    cards[index] = card;
    if (Meteor.isServer) console.log('update chosen cards', index, card);
    await Cards.updateAsync(
      { playerId: this._id },
      {
        $set: { chosenCards: cards },
      }
    );
    this.cards[index] = CardLogic.COVERED;
    await Players.updateAsync(this._id, {
      $set: { cards: this.cards },
      $inc: { chosenCardsCnt: inc },
    });
  },
  async unchooseCardAsync(index) {
    const cards = await this.getChosenCardsAsync();
    if (cards[index] !== CardLogic.EMPTY) {
      cards[index] = CardLogic.EMPTY;
      await Cards.updateAsync(
        { playerId: this._id },
        {
          $set: { chosenCards: cards },
        }
      );
      this.cards[index] = CardLogic.EMPTY;
      await Players.updateAsync(this._id, {
        $set: { cards: this.cards },
        $inc: { chosenCardsCnt: -1 },
      });
    }
  },
  async isOnBoardAsync() {
    const board = await this.boardAsync();
    const a = board.onBoard(this.position.x, this.position.y);
    if (!a) {
      console.log('Player fell off the board', this.name);
    }
    return a;
  },
  async isOnVoidAsync() {
    const tile = await this.tileAsync();
    const a = tile.type === Tile.VOID;
    if (a) {
      console.log('Player fell into the void', this.name);
    }
    return a;
  },
  updateStartPosition() {
    this.start = { x: this.position.x, y: this.position.y };
  },
  move(step) {
    this.position.x += step.x;
    this.position.y += step.y;
  },
  rotate(rotation) {
    this.direction += rotation + 4;
    this.direction %= 4;
  },
  async chatAsync(msg, debug_info) {
    msg = `${this.name} ${msg}`;
    await Chat.insertAsync({
      gameId: this.gameId,
      message: msg,
      submitted: new Date().getTime(),
    });
    if (debug_info !== undefined) msg += ` ${debug_info}`;
    console.log(msg);
  },
  async togglePowerDownAsync() {
    switch (this.powerState) {
      case GameLogic.DOWN:
        this.powerState = GameLogic.ON;
        break;
      case GameLogic.ON:
        this.powerState = GameLogic.DOWN;
        break;
      case GameLogic.OFF:
        this.powerState = GameLogic.ON;
        break;
    }
    console.log(`new power state ${this.powerState}`);
    await Players.updateAsync(this._id, { $set: { powerState: this.powerState } });
    return this.powerState;
  },
  isPoweredDown() {
    return this.powerState === GameLogic.OFF;
  },

  lockedCnt() {
    return Math.max(0, GameLogic.CARD_SLOTS + this.damage - CardLogic._MAX_NUMBER_OF_CARDS);
  },
  notLockedCnt() {
    return GameLogic.CARD_SLOTS - this.lockedCnt();
  },
  isActive() {
    return !this.isPoweredDown() && !this.needsRespawn && this.lives > 0;
  },
  async addDamageAsync(inc) {
    console.debug('addDamageAsync');
    if (this.hasOptionCard('ablative_coat')) {
      this.ablativeCoat ??= 0;
      this.ablativeCoat++;
      if (this.ablativeCoat >= 3) {
        this.ablativeCoat = null;
        await this.discardOptionCardAsync('ablative_coat');
      }
      await Players.updateAsync(this._id, {
        $set: {
          ablativeCoat: this.ablativeCoat,
          optionCards: this.optionCards,
        },
      });
    } else {
      const oldLockedCnt = Math.max(
        0,
        GameLogic.CARD_SLOTS + this.damage - CardLogic._MAX_NUMBER_OF_CARDS
      );
      this.damage += inc;
      const newLockedCnt = this.lockedCnt();
      if (this.isPoweredDown() && newLockedCnt > oldLockedCnt) {
        // powered down robot has no cards, so draw from the deck for slots that
        // are NEWLY locked by this damage. Already-locked slots keep their card.
        const game = await this.gameAsync();
        const deck = await game.getDeckAsync();
        const chosenCards = await this.getChosenCardsAsync();
        for (
          let slot = GameLogic.CARD_SLOTS - newLockedCnt;
          slot < GameLogic.CARD_SLOTS - oldLockedCnt;
          slot++
        ) {
          this.cards[slot] = deck.cards.shift();
          chosenCards[slot] = this.cards[slot];
        }
        await Deck.updateAsync(deck._id, deck);
        await Players.updateAsync(this._id, this);
        await Cards.updateAsync(
          { playerId: this._id },
          {
            $set: {
              chosenCards,
            },
          }
        );
      }
    }
  },
  async drawOptionCardAsync() {
    const game = await this.gameAsync();
    const gameId = game._id;
    const deckDoc = await Deck.findOneAsync({ gameId });
    const { optionCards } = deckDoc;
    //Ensure that there are option cards to choose from and then update game deck.
    if (optionCards.length) {
      const optionId = optionCards.pop();
      const name = CardLogic.getOptionName(optionId);
      this.optionCards[name] = true;
      await Deck.updateAsync({ gameId }, { $set: { optionCards } });
      // Announce the draw: it happens inside the repairs phase with no other visual,
      // so without this line players only discover the card by inspecting the panel.
      await this.chatAsync(`drew option card ${CardLogic.getOptionTitle(name)}`);
    }
  },
  async discardOptionCardAsync(name) {
    const game = await this.gameAsync();
    const gameId = game._id;
    delete this.optionCards[name];
    const deckDoc = await Deck.findOneAsync({ gameId });
    const discarded = deckDoc.discardedOptionCards;
    discarded.push(CardLogic.getOptionId(name));
    await Deck.updateAsync({ gameId }, { $set: { discardedOptionCards: discarded } });
    // Announce the discard for the same reason as the draw: both circuit_breaker
    // (deal phase) and ablative_coat (mid-laser-fire) discard with no visual cue.
    await this.chatAsync(`discarded option card ${CardLogic.getOptionTitle(name)}`);
  },
};

export const Players = new Meteor.Collection('players', {
  transform(doc) {
    const newInstance = Object.create(player);
    return Object.assign(newInstance, doc);
  },
});

Players.allow({
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
