import { Mongo } from 'meteor/mongo';
import { AnyOf, ID, Optional } from 'meteor/jam:easy-schema';
import { CardLogic } from '../both/cardlogic.ts';
import { Null } from '../both/easySchemaConfig.ts';
import { GameLogic } from '../both/gamelogic.ts';
import type { Doc } from '../both/schemas/infer.ts';
import { shuffle } from '../both/shuffle.ts';
import { Tile } from '../both/tile.ts';
import { Cards } from './cards.ts';
import { Chat } from './chat.ts';
import { Decks } from './deck.ts';
import { Games, type Game } from './games.ts';

// The document's fields and the transform's methods, merged: the interface carries the
// fields so `this` is typed inside the class, and `Object.create(Player.prototype)` below
// is what joins the two at runtime — the same prototype-not-constructor shape as before.
// `PlayerDoc` is declared with the schema further down, where the fields are.
export interface Player extends PlayerDoc {}
export class Player {
  // A player always belongs to a game, so the reads below assert rather than narrow: the
  // `joinGame` insert writes `gameId` and `leaveGame` removes the player with the game.
  game() {
    return Games.findOne(this.gameId)!;
  }
  async gameAsync() {
    return Games.findOneAsync(this.gameId) as Promise<Game>;
  }
  board() {
    return Games.findOne(this.gameId)!.board();
  }
  async boardAsync() {
    const game = (await Games.findOneAsync(this.gameId))!;
    return game.board();
  }
  tile() {
    return this.board().getTile(this.position.x, this.position.y);
  }
  async tileAsync() {
    const board = await this.boardAsync();
    return board.getTile(this.position.x, this.position.y);
  }
  getHandCards() {
    const c = Cards.findOne({ playerId: this._id });
    return c ? c.handCards : [];
  }
  async getHandCardsAsync() {
    const c = await Cards.findOneAsync({ playerId: this._id });
    return c ? c.handCards : [];
  }
  getChosenCards() {
    const c = Cards.findOne({ playerId: this._id });
    return c ? c.chosenCards : [];
  }
  async getChosenCardsAsync() {
    const c = await Cards.findOneAsync({ playerId: this._id });
    return c ? c.chosenCards : [];
  }
  hasOptionCard(optionName: string) {
    return Boolean(this.optionCards[optionName]);
  }
  async chooseCardAsync(card: number, index: number) {
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
  }
  async unchooseCardAsync(index: number) {
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
  }
  async isOnBoardAsync() {
    const board = await this.boardAsync();
    const a = board.onBoard(this.position.x, this.position.y);
    if (!a) {
      console.log('Player fell off the board', this.name);
    }
    return a;
  }
  async isOnVoidAsync() {
    const tile = await this.tileAsync();
    const a = tile.type === Tile.VOID;
    if (a) {
      console.log('Player fell into the void', this.name);
    }
    return a;
  }
  // Persist this instance back as a whole document. Every field is written, so a field the
  // caller cleared is cleared in the database too — that is the point at the dozen sites
  // that mutate an instance across several steps and save once at the end.
  //
  // The spread is load-bearing, not tidiness: the transform hands out
  // `Object.create(Player.prototype)`, and the schema check refuses anything whose
  // prototype is not `Object.prototype` with a bare 'Expected plain object'. Own enumerable
  // properties are exactly the document's fields — the methods live on the prototype — so
  // the copy is the document and nothing else.
  async saveAsync() {
    return await Players.updateAsync(this._id, { ...this });
  }
  updateStartPosition() {
    // `Infer` can only make a schema's *top-level* `Optional` keys absent, so the nested
    // `direction` reads as required-but-undefined and the literal has to be asserted.
    // Leaving it out is the schema's intent — see the field's comment below.
    this.start = { x: this.position.x, y: this.position.y } as PlayerDoc['start'];
  }
  move(step: { x: number; y: number }) {
    this.position.x += step.x;
    this.position.y += step.y;
  }
  // `direction` is optional on the document but set before a robot can ever rotate:
  // `startGame` writes it with the start position, and so does every respawn.
  rotate(rotation: number) {
    this.direction = this.direction! + rotation + 4;
    this.direction %= 4;
  }
  async chatAsync(msg: string, debug_info?: string | number) {
    msg = `${this.name} ${msg}`;
    await Chat.insertAsync({
      gameId: this.gameId,
      message: msg,
      submitted: new Date().getTime(),
    });
    if (debug_info !== undefined) msg += ` ${debug_info}`;
    console.log(msg);
  }
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
  }
  isPoweredDown() {
    return this.powerState === GameLogic.OFF;
  }

  lockedCnt() {
    return Math.max(0, GameLogic.CARD_SLOTS + this.damage - CardLogic._MAX_NUMBER_OF_CARDS);
  }
  notLockedCnt() {
    return GameLogic.CARD_SLOTS - this.lockedCnt();
  }
  isActive() {
    return !this.isPoweredDown() && !this.needsRespawn && this.lives > 0;
  }
  async addDamageAsync(inc: number) {
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
          // `shift()` on an exhausted deck would put `undefined` in the slot, exactly as
          // it did before the types; the `!` records that rather than changing it.
          this.cards[slot] = deck.cards.shift()!;
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
  }
  async drawOptionCardAsync() {
    const game = await this.gameAsync();
    const gameId = game._id;
    // Every game has a deck by the time option cards are drawn: the repairs phase runs
    // after a deal, and the deal is what creates one.
    const deckDoc = (await Decks.findOneAsync({ gameId }))!;
    let { optionCards, discardedOptionCards } = deckDoc;
    // An empty draw pile takes the shuffled discard pile as its refill; with both
    // piles empty no card is drawn and the player simply gets nothing.
    if (!optionCards.length && discardedOptionCards.length) {
      optionCards = shuffle(discardedOptionCards);
      discardedOptionCards = [];
    }
    if (optionCards.length) {
      // Guarded by the `optionCards.length` check on the line above.
      const optionId = optionCards.pop()!;
      const name = CardLogic.getOptionName(optionId);
      this.optionCards[name] = true;
      await Decks.updateAsync({ gameId }, { $set: { optionCards, discardedOptionCards } });
      // Announce the draw: it happens inside the repairs phase with no other visual,
      // so without this line players only discover the card by inspecting the panel.
      await this.chatAsync(`drew option card ${CardLogic.getOptionTitle(name)}`);
    }
  }
  async discardOptionCardAsync(name: string) {
    const game = await this.gameAsync();
    const gameId = game._id;
    delete this.optionCards[name];
    // A card can only be discarded if it was drawn, so the deck it came from is there.
    const deckDoc = (await Decks.findOneAsync({ gameId }))!;
    const discarded = deckDoc.discardedOptionCards;
    // `getOptionId` falls off the end — undefined — for a name that is not in the option
    // deck. Every `name` that reaches here is a key of some player's `optionCards`, and
    // those are only ever written from `getOptionName`, so it is always a real card.
    discarded.push(CardLogic.getOptionId(name)!);
    await Decks.updateAsync({ gameId }, { $set: { discardedOptionCards: discarded } });
    // Announce the discard for the same reason as the draw: both circuit_breaker
    // (deal phase) and ablative_coat (mid-laser-fire) discard with no visual cue.
    await this.chatAsync(`discarded option card ${CardLogic.getOptionTitle(name)}`);
  }
}

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
  // Hits soaked by an ablative coat, 0..2 — then null when the card is spent, which is
  // also what `joinGame` seeds and what the startup backfill in server/cron.ts fills in
  // on players who predate the key. `AnyOf(X, Null)` rather than `Optional(AnyOf(X,
  // Null))`: the third state, absent, meant nothing to any reader.
  ablativeCoat: AnyOf(Number, Null),
  // --- everything below arrives later ---
  //
  // 0..3, set when the game starts and on respawn.
  direction: Optional(Number),
  // A stringified array index — see the `for...in` note in both/methods/games.ts.
  robotId: Optional(String),
  // `startGame` writes the board's startpoint, {x, y, direction}; the first checkpoint or
  // repair tile then REPLACES it with {x, y} only, so `direction` has to stay optional.
  start: Optional({ x: Number, y: Number, direction: Optional(Number) }),
  submitted: Optional(Boolean),
  playedCardsCnt: Optional(Number),
  // How far this player's laser reached, for drawing the beam.
  shotDistance: Optional(Number),
};

export type PlayerDoc = Doc<typeof schema>;

// `Mongo.Collection` rather than the `Meteor.Collection` alias — see the note in
// collections/chat.ts for why the alias silently ignores the schema.
export const Players = new Mongo.Collection<PlayerDoc, Player>('players', {
  schema,
  transform(doc) {
    const newInstance = Object.create(Player.prototype);
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
