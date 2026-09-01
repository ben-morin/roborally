import { Mongo } from 'meteor/mongo';
import { AnyOf, ID, Optional } from 'meteor/jam:easy-schema';
import { CardLogic } from '../both/cardlogic.js';
import { Null } from '../both/easySchemaConfig.js';
import { GameLogic } from '../both/gamelogic.js';
import { shuffle } from '../both/shuffle.js';
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
  // Persist this instance back as a whole document. Every field is written, so a field the
  // caller cleared is cleared in the database too — that is the point at the dozen sites
  // that mutate an instance across several steps and save once at the end.
  //
  // The spread is load-bearing, not tidiness: the transform hands out
  // `Object.create(player)`, and the schema check refuses anything whose prototype is not
  // `Object.prototype` with a bare 'Expected plain object'. Own enumerable properties are
  // exactly the document's fields — the methods live on the prototype — so the copy is the
  // document and nothing else.
  async saveAsync() {
    return await Players.updateAsync(this._id, { ...this });
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
        await deck.saveAsync();
        await this.saveAsync();
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
    let { optionCards, discardedOptionCards } = deckDoc;
    // An empty draw pile takes the shuffled discard pile as its refill; with both
    // piles empty no card is drawn and the player simply gets nothing.
    if (!optionCards.length && discardedOptionCards.length) {
      optionCards = shuffle(discardedOptionCards);
      discardedOptionCards = [];
    }
    if (optionCards.length) {
      const optionId = optionCards.pop();
      const name = CardLogic.getOptionName(optionId);
      this.optionCards[name] = true;
      await Deck.updateAsync({ gameId }, { $set: { optionCards, discardedOptionCards } });
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

// The whole player document. The block above the divider is what `joinGame` inserts;
// everything below it is added later, once a game starts, by a `$set` or by one of the
// dozen sites that persist a transform instance back whole. Both halves have to be here:
// a whole-document write is checked against the full schema, and the database validator
// generates `additionalProperties: false`, so a field the schema does not name is refused.
//
// A whole-document write is safe to check this way because the transform puts its methods
// on the prototype — an instance's own enumerable properties are exactly the document's
// fields.
const schema = {
  _id: ID,
  gameId: String,
  userId: String,
  name: String,
  lives: Number,
  damage: Number,
  visited_checkpoints: Number,
  needsRespawn: Boolean,
  // GameLogic.DOWN 2 / OFF 4 / ON 5.
  powerState: Number,
  optionalInstantPowerDown: Boolean,
  // {-1, -1} until the game starts, and y = board.height while parked off the board.
  position: { x: Number, y: Number },
  chosenCardsCnt: Number,
  // A dynamic map, option name -> true. Bare `Object` on purpose: the keys are card
  // names, so listing them here would be a second copy of CardLogic's option deck.
  optionCards: Object,
  // The five register slots: a card id, or one of the CardLogic sentinels -1..-4.
  cards: [Number],
  // --- everything below arrives later ---
  //
  // 0..3, set when the game starts and on respawn.
  direction: Optional(Number),
  // A stringified array index — see the `for...in` note in server/methods.js.
  robotId: Optional(String),
  // `startGame` writes the board's startpoint, {x, y, direction}; the first checkpoint or
  // repair tile then REPLACES it with {x, y} only, so `direction` has to stay optional.
  start: Optional({ x: Number, y: Number, direction: Optional(Number) }),
  submitted: Optional(Boolean),
  playedCardsCnt: Optional(Number),
  // How far this player's laser reached, for drawing the beam.
  shotDistance: Optional(Number),
  // Hits soaked by an ablative coat, 0..2 — then null when the card is spent.
  ablativeCoat: Optional(AnyOf(Number, Null)),
};

// `Mongo.Collection` rather than the `Meteor.Collection` alias — see the note in
// collections/chat.js for why the alias silently ignores the schema.
export const Players = new Mongo.Collection('players', {
  schema,
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
