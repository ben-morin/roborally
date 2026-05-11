let timerHandle = null;
const cardsState = new ReactiveDict();

// Compute seconds remaining from the server-stored timer start time. Returns 0
// when the timer is not active. Establishes a reactive dependency on the tick
// counter so callers re-run once per second while the timer is live.
function getTimeLeft(game) {
  if (!game || game.timer !== 1 || !game.timerStartedAt) return 0;
  cardsState.get('tick'); // reactive dep — invalidated each second by setInterval
  const elapsed = (Date.now() - new Date(game.timerStartedAt).getTime()) / 1000;
  return Math.max(0, GameLogic.TIMER - Math.floor(elapsed));
}

function getGame() {
  const id = FlowRouter.getParam('_id');
  if (id) {
    return Games.findOne(id);
  }
}

function getCardData() {
  return Cards.findOne();
}

function getHandCards() {
  const c = getCardData();
  return c ? c.handCards : [];
}

function getChosenCards() {
  const c = getCardData();
  return c ? c.chosenCards : [];
}

Template.cards.helpers({
  player: function () {
    return Players.findOne({ userId: Meteor.userId() });
  },
  otherPlayers: function () {
    const game = getGame();
    if (!game) return [];
    return Players.find({ gameId: game._id, userId: { $ne: Meteor.userId() } });
  },
  chosenCards: function () {
    return addUIData(
      getChosenCards(),
      false,
      getPlayer().lockedCnt(),
      true,
      getPlayer().game().playerCnt()
    );
  },
  availableCards: function () {
    const cards = getHandCards();
    if (cards.length < 9) {
      //add empty cards^
      for (let j = cards.length; j < 9; j++) {
        cards.push(CardLogic.DAMAGE);
      }
    }
    const chosenIds = new Set(
      getChosenCards().filter(function (id) {
        return id !== CardLogic.EMPTY;
      })
    );
    return addUIData(cards, true, false, false, getPlayer().game().playerCnt(), chosenIds);
  },
  showCards: function () {
    const game = getGame();
    const player = getPlayer();
    return (
      game &&
      game.gamePhase === GameState.PHASE.PROGRAM &&
      typeof player !== 'undefined' &&
      !player.submitted &&
      player.lives > 0
    );
  },
  showPlayButton: function () {
    return !getPlayer().submitted;
  },
  timer: function () {
    const game = getGame();
    if (!game) return '';
    const player = getPlayer();
    const isNonPlayer = !player || player.lives <= 0;
    const timeLeft = getTimeLeft(game);

    // Manage the per-second tick interval (drives reactive re-runs while the
    // timer is active).
    if (game.timer === 1 && timerHandle === null) {
      console.log('starting timer');
      timerHandle = Meteor.setInterval(function () {
        cardsState.set('tick', Date.now());
      }, 1000);
    }
    if (game.timer !== 1 && timerHandle !== null) {
      Meteor.clearInterval(timerHandle);
      timerHandle = null;
    }

    if (game.timer === 0 && !isNonPlayer) {
      submitCards(game);
    }

    // Apply countdown / finish classes on every helper run so state survives
    // page reloads and late template mounts. Each run derives the correct
    // class set from current values; classList.toggle removes them when the
    // condition flips false.
    const rightPanelCards = document.querySelectorAll('.right-panel .card');
    const me = Players.findOne({ userId: Meteor.userId() });
    const showTimer = game.timer === 1 && !isNonPlayer && me && !me.submitted;
    const showFinish = showTimer && timeLeft <= 5;
    rightPanelCards.forEach((el) => {
      el.classList.toggle('countdown', showTimer && !showFinish);
      el.classList.toggle('finish', showFinish);
    });

    return isNonPlayer ? '' : timeLeft > 0 ? '(' + timeLeft + ')' : '';
  },
  gameState: function () {
    const game = getGame();
    if (!game) return '';
    switch (game.gamePhase) {
      case GameState.PHASE.IDLE:
      case GameState.PHASE.DEAL:
        return 'Dealing cards';
      case GameState.PHASE.ENDED:
        return 'Game over';
      case GameState.PHASE.PROGRAM: {
        const player = getPlayer();
        if (!player) {
          return 'Players thinking';
        } else if (player.lives <= 0) {
          return 'No archives';
        } else if (player.isPoweredDown() && !player.optionalInstantPowerDown) {
          return 'Powered down';
        } else {
          return 'Pick your cards';
        }
        break;
      }
      case GameState.PHASE.PLAY:
        switch (game.playPhase) {
          case GameState.PLAY_PHASE.IDLE:
          case GameState.PLAY_PHASE.REVEAL_CARDS:
            return 'Revealing cards';
          case GameState.PLAY_PHASE.MOVE_BOTS:
            return 'Moving bots';
          case GameState.PLAY_PHASE.MOVE_BOARD:
            return 'Moving board elements';
          case GameState.PLAY_PHASE.LASERS:
            return 'Shooting lasers';
          case GameState.PLAY_PHASE.CHECKPOINTS:
            return 'Checkpoints';
          case GameState.PLAY_PHASE.REPAIRS:
            return 'Repairing bots';
        }
        break;
      case GameState.PHASE.RESPAWN:
        switch (game.respawnPhase) {
          case GameState.RESPAWN_PHASE.CHOOSE_POSITION:
            if (game.respawnUserId === Meteor.userId()) {
              return 'Choose position';
            } else {
              return 'Waiting for destroyed bots to reenter';
            }
            break;
          case GameState.RESPAWN_PHASE.CHOOSE_DIRECTION:
            if (game.respawnUserId === Meteor.userId()) {
              return 'Choose direction';
            } else {
              return 'Waiting for destroyed bots to reenter';
            }
        }
        break;
    }
    console.log(game.gamePhase, game.playPhase, game.respawnPhase);
    return 'Problem?';
  },
  ownPowerStateName: function () {
    switch (getPlayer().powerState) {
      case GameLogic.OFF:
        return 'cancel power down';
      case GameLogic.DOWN:
        return 'withdraw power down';
      case GameLogic.ON:
        return 'announce power down';
    }
  },
  ownPowerStateStyle: function () {
    switch (getPlayer().powerState) {
      case GameLogic.DOWN:
      case GameLogic.OFF:
        return 'btn-danger';
      case GameLogic.ON:
        return 'btn-outline-warning';
    }
  },
  poweredDown: function () {
    return getPlayer().isPoweredDown();
  },
  lives: function () {
    const hearts = [];
    for (let i = 0; i < 3; i++) {
      if (i < getPlayer().lives) {
        hearts.push('fa-heart');
      } else {
        hearts.push('fa-heart-o');
      }
    }
    return hearts;
  },
  dmgPercentage: function () {
    return this.damage * 10;
  },
  headingForFinish: function () {
    return this.visited_checkpoints === this.board().checkpoints.length - 1;
  },
  nextCheckpoint: function () {
    return this.visited_checkpoints + 1;
  },
  hasOptionCards: function () {
    return Object.keys(getPlayer().optionCards).length > 0;
  },
  activeOptionCards: function () {
    const r = [];
    Object.keys(getPlayer().optionCards).forEach(function (optionKey) {
      r.push({
        name: CardLogic.getOptionTitle(optionKey),
        desc: CardLogic.getOptionDesc(optionKey),
      });
    });
    return r;
  },
});

Template.card.onRendered(function () {
  const instance = this;
  const update = () => {
    const card = instance.find('.gamecard');
    if (card) {
      card.style.setProperty('--card-w', card.offsetWidth + 'px');
    }
  };

  // Re-bind on every data context change: the {{#if emptyCard}} branches emit
  // distinct .gamecard elements, so flipping between empty and chosen swaps
  // the DOM node out from under any prior measurement and observer.
  instance.autorun(() => {
    Template.currentData();
    Tracker.afterFlush(() => {
      if (instance._cardResizeObserver) {
        instance._cardResizeObserver.disconnect();
        instance._cardResizeObserver = null;
      }
      update();
      const card = instance.find('.gamecard');
      if (card && typeof ResizeObserver !== 'undefined') {
        instance._cardResizeObserver = new ResizeObserver(update);
        instance._cardResizeObserver.observe(card);
      }
    });
  });
});

Template.card.onDestroyed(function () {
  if (this._cardResizeObserver) {
    this._cardResizeObserver.disconnect();
  }
});

Template.card.helpers({
  emptyCard: function () {
    return this.type === 'empty';
  },
  dmgCard: function () {
    return this.type === 'dmg';
  },
  coveredCard: function () {
    return this.type === 'covered';
  },
  selected: function () {
    return this.slot === getSlotIndex() ? 'selected' : '';
  },
  isSelected: function () {
    return this.slot === getSlotIndex();
  },
  timer: function () {
    const timeLeft = getTimeLeft(getGame());
    return timeLeft > 0 ? '(' + timeLeft + ')' : '';
  },
});

Template.playerStatus.helpers({
  playerName: function () {
    if (this.userId === Meteor.userId()) {
      return 'Your robot';
    } else {
      return this.name;
    }
  },
  cardsHtml: function () {
    if (this.lives <= 0) return [];
    return addUIData(this.cards || [], false, this.lockedCnt(), false, this.game().playerCnt());
  },
  lives: function () {
    l = [];
    for (let i = 0; i < 3; i++) {
      if (i < this.lives) {
        l.push('fa-heart');
      } else {
        l.push('fa-heart-o');
      }
    }
    return l;
  },
  dmgPercentage: function () {
    return this.damage * 10;
  },
  power: function () {
    if (this.powerState === GameLogic.OFF) {
      return 'powered down';
    } else if (this.powerState === GameLogic.DOWN) {
      return 'power down played';
    }
  },
  isWinner: function () {
    return this.visited_checkpoints >= this.board().checkpoints.length;
  },
  headingForFinish: function () {
    return this.visited_checkpoints === this.board().checkpoints.length - 1;
  },
  nextCheckpoint: function () {
    return Math.min(this.board().checkpoints.length, this.visited_checkpoints + 1);
  },
  showOutOfGameLabel: function () {
    return this.lives <= 0;
  },
  showSubmittedLabel: function () {
    return this.lives > 0 && this.submitted && this.game().gamePhase === GameState.PHASE.PROGRAM;
  },
  showPoweredDownLabel: function () {
    return (
      this.lives > 0 &&
      this.powerState === GameLogic.OFF &&
      (this.game().gamePhase !== GameState.PHASE.PROGRAM || this.submitted)
    );
  },
  powerDownPlayed: function () {
    return this.lives > 0 && this.powerState === GameLogic.DOWN;
  },
  hasOptionCards: function () {
    return Object.keys(this.optionCards).length > 0;
  },
  activeOptionCards: function () {
    const r = [];
    Object.keys(this.optionCards).forEach(function (optionKey) {
      r.push({
        name: CardLogic.getOptionTitle(optionKey),
        desc: CardLogic.getOptionDesc(optionKey),
      });
    });
    return r;
  },
});

Template.card.events({
  'click .available': function (e) {
    if (this.chosen) return;
    const player = getPlayer();
    if (player.submitted) return;
    const currentSlot = getSlotIndex();
    if (!isEmptySlot(currentSlot)) return;

    cardsState.set('selectedSlot', getNextEmptySlotIndex(currentSlot));
    chooseCard(player.gameId, this.cardId, currentSlot);
    console.log('choose card ', this.cardId, ' for slot ', currentSlot);

    if (player.isPoweredDown()) {
      Meteor.callAsync('togglePowerDown', player.gameId).then(
        function (powerState) {
          document
            .querySelectorAll('.playBtn')
            .forEach((el) => el.classList.toggle('disabled', !allowSubmit()));
        },
        function (error) {
          modalAlert(error.reason);
        }
      );
    }
  },
  'click .played': function (e) {
    if (this.locked) return;
    if (isEmptySlot(this.slot)) return;
    const player = getPlayer();
    if (player.submitted) return;
    unchooseCard(player.gameId, this.slot);
    cardsState.set('selectedSlot', this.slot);
  },
  'click .empty': function (e) {
    if (!getPlayer().submitted) {
      cardsState.set('selectedSlot', this.slot);
    }
  },
});

Template.cards.events({
  'click .playBtn': function (e) {
    const game = getGame();
    if (game) submitCards(game);
  },
  'click .powerBtn': function (e) {
    const game = getGame();
    if (!game) return;
    Meteor.callAsync('togglePowerDown', game._id).then(
      function (powerState) {
        if (powerState === GameLogic.OFF) {
          unchooseAllCards(getPlayer());
        }
        document
          .querySelectorAll('.playBtn')
          .forEach((el) => el.classList.toggle('disabled', !allowSubmit()));
      },
      function (error) {
        modalAlert(error.reason);
      }
    );
  },
});

function getPlayer() {
  return Players.findOne({ userId: Meteor.userId() });
}

function chooseCard(gameId, card, slot) {
  Meteor.callAsync('selectCard', gameId, card, slot).then(
    function (chosenCards) {
      document
        .querySelectorAll('.playBtn')
        .forEach((el) => el.classList.toggle('disabled', !allowSubmit()));
    },
    function (error) {
      modalAlert(error.reason);
    }
  );
}

function unchooseCard(gameId, slot) {
  Meteor.callAsync('deselectCard', gameId, slot).then(
    function (chosenCards) {
      document
        .querySelectorAll('.playBtn')
        .forEach((el) => el.classList.toggle('disabled', !allowSubmit()));
    },
    function (error) {
      modalAlert(error.reason);
    }
  );
}

function unchooseAllCards(player) {
  cardsState.set('selectedSlot', 0);
  Meteor.callAsync('deselectAllCards', player.gameId).catch(function (error) {
    modalAlert(error.reason);
  });
}

function getChosenCnt() {
  return getPlayer().chosenCardsCnt;
}

function getSlotIndex() {
  const slot = cardsState.get('selectedSlot');
  if (slot == null) {
    return getFirstEmptySlotIndex();
  }
  return slot;
}

function isEmptySlot(index) {
  return getChosenCards()[index] === CardLogic.EMPTY;
}

function getFirstEmptySlotIndex() {
  const chosen = getChosenCards();
  for (let i = 0; i < GameLogic.CARD_SLOTS; i++) {
    if (chosen[i] === CardLogic.EMPTY) {
      return i;
    }
  }
  return 0;
}

function getNextEmptySlotIndex(currentSlot) {
  const chosen = getChosenCards();
  for (let j = currentSlot + 1; j < currentSlot + GameLogic.CARD_SLOTS; j++) {
    const k = j % GameLogic.CARD_SLOTS;
    if (chosen[k] === CardLogic.EMPTY) {
      return k;
    }
  }
  return 0;
}

function allowSubmit() {
  return getChosenCnt() === 5 || getPlayer().isPoweredDown();
}

function submitCards(game) {
  console.log('submitting cards');
  document
    .querySelectorAll('.right-panel .card')
    .forEach((el) => el.classList.remove('countdown', 'finish'));
  Meteor.callAsync('playCards', game._id).then(
    function () {
      cardsState.set('selectedSlot', 0);
    },
    function (error) {
      cardsState.set('selectedSlot', 0);
      modalAlert(error.reason);
    }
  );
}

function addUIData(cards, available, locked, selectable, numberOfPlayers, chosenIds) {
  const uiCards = [];
  cards.forEach(function (card, i) {
    const cardProp = {
      cardId: card,
    };
    if (selectable) {
      cardProp.slot = i;
    }
    switch (card) {
      case CardLogic.RANDOM:
        cardProp.type = 'random';
        break;
      case CardLogic.DAMAGE:
        cardProp.type = 'dmg';
        break;
      case CardLogic.COVERED:
        cardProp.type = 'covered';
        break;
      case CardLogic.EMPTY:
        cardProp.type = 'empty';
        break;
      default:
        if (card !== null && typeof card !== 'undefined') {
          const ct = CardLogic.cardType(card, numberOfPlayers);
          if (ct) {
            cardProp.class = available ? 'available' : 'played';
            cardProp.priority = CardLogic.priority(card);
            if (locked && i >= GameLogic.CARD_SLOTS - locked) {
              cardProp.class += ' locked';
              cardProp.locked = true;
            }
            if (available && chosenIds && chosenIds.has(card)) {
              cardProp.class += ' chosen';
              cardProp.chosen = true;
            }
            cardProp.type = ct.name;
          } else {
            console.warn('Unknown card type for card:', card);
            cardProp.type = 'empty';
          }
        }
    }
    uiCards.push(cardProp);
  });
  return uiCards;
}
