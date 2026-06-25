const player = {
  game: function () {
    return Games.findOne(this.gameId);
  },
  gameAsync: async function () {
    return Games.findOneAsync(this.gameId);
  },
  board: function () {
    return Games.findOne(this.gameId).board();
  },
  boardAsync: async function () {
    const game = await Games.findOneAsync(this.gameId);
    return game.board();
  },
  tile: function () {
    return this.board().getTile(this.position.x, this.position.y);
  },
  tileAsync: async function () {
    const board = await this.boardAsync();
    return board.getTile(this.position.x, this.position.y);
  },
  getHandCards: function () {
    const c = Cards.findOne({ playerId: this._id });
    return c ? c.handCards : [];
  },
  getHandCardsAsync: async function () {
    const c = await Cards.findOneAsync({ playerId: this._id });
    return c ? c.handCards : [];
  },
  getChosenCards: function () {
    const c = Cards.findOne({ playerId: this._id });
    return c ? c.chosenCards : [];
  },
  getChosenCardsAsync: async function () {
    const c = await Cards.findOneAsync({ playerId: this._id });
    return c ? c.chosenCards : [];
  },
  hasOptionCard: function (optionName) {
    return this.optionCards[optionName];
  },
  updateHandCardsAsync: async function (cards) {
    await Cards.upsertAsync({ playerId: this._id }, { $set: { handCards: cards } });
  },
  chooseCardAsync: async function (card, index) {
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
  unchooseCardAsync: async function (index) {
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
  isOnBoardAsync: async function () {
    const board = await this.boardAsync();
    const a = board.onBoard(this.position.x, this.position.y);
    if (!a) {
      console.log('Player fell off the board', this.name);
    }
    return a;
  },
  isOnVoidAsync: async function () {
    const tile = await this.tileAsync();
    const a = tile.type === Tile.VOID;
    if (a) {
      console.log('Player fell into the void', this.name);
    }
    return a;
  },
  updateStartPosition: function () {
    this.start = { x: this.position.x, y: this.position.y };
  },
  move: function (step) {
    this.position.x += step.x;
    this.position.y += step.y;
  },
  rotate: function (rotation) {
    this.direction += rotation + 4;
    this.direction %= 4;
  },
  chatAsync: async function (msg, debug_info) {
    msg = this.name + ' ' + msg;
    await Chat.insertAsync({
      gameId: this.gameId,
      message: msg,
      submitted: new Date().getTime(),
    });
    if (debug_info !== undefined) msg += ' ' + debug_info;
    console.log(msg);
  },
  togglePowerDownAsync: async function () {
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
    console.log('new power state ' + this.powerState);
    await Players.updateAsync(this._id, { $set: { powerState: this.powerState } });
    return this.powerState;
  },
  isPoweredDown: function () {
    return this.powerState === GameLogic.OFF;
  },

  lockedCnt: function () {
    return Math.max(0, GameLogic.CARD_SLOTS + this.damage - CardLogic._MAX_NUMBER_OF_CARDS);
  },
  notLockedCnt: function () {
    return GameLogic.CARD_SLOTS - this.lockedCnt();
  },
  isActive: function () {
    return !this.isPoweredDown() && !this.needsRespawn && this.lives > 0;
  },
  addDamageAsync: async function (inc) {
    console.debug('addDamageAsync');
    if (this.hasOptionCard('ablative_coat')) {
      if (this.ablativeCoat == null) {
        this.ablativeCoat = 0;
      }
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
              chosenCards: chosenCards,
            },
          }
        );
      }
    }
  },
  drawOptionCardAsync: async function () {
    const game = await this.gameAsync();
    const gameId = game._id;
    const deckDoc = await Deck.findOneAsync({ gameId: gameId });
    const optionCards = deckDoc.optionCards;
    //Ensure that there are option cards to choose from and then update game deck.
    if (optionCards.length) {
      const optionId = optionCards.pop();
      this.optionCards[CardLogic.getOptionName(optionId)] = true;
      await Deck.updateAsync({ gameId: gameId }, { $set: { optionCards: optionCards } });
    }
  },
  discardOptionCardAsync: async function (name) {
    const game = await this.gameAsync();
    const gameId = game._id;
    delete this.optionCards[name];
    const deckDoc = await Deck.findOneAsync({ gameId: gameId });
    const discarded = deckDoc.discardedOptionCards;
    discarded.push(CardLogic.getOptionId(name));
    await Deck.updateAsync({ gameId: gameId }, { $set: { discardedOptionCards: discarded } });
  },
};

Players = new Meteor.Collection('players', {
  transform: function (doc) {
    const newInstance = Object.create(player);
    return Object.assign(newInstance, doc);
  },
});

Players.allow({
  insert: function (userId, doc) {
    return false;
  },
  update: function (userId, doc) {
    return false;
  },
  remove: function (userId, doc) {
    return false;
  },
});
