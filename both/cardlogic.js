import { Cards } from '../collections/cards.js';
import { Deck } from '../collections/deck.js';
import { Games } from '../collections/games.js';
import { Players } from '../collections/players.js';
import { GameLogic } from './gamelogic.js';
import { GameState } from './gamestate.js';

// Exported so the cron watchdog can re-drive a timer the server lost — see
// "Recover stalled programming timers" in server/cron.js. Recovery deliberately reuses
// this exact function rather than reimplementing it, so the two cannot drift; the guard
// below is what makes calling it a second time safe.
export async function autoSubmitIfTimedOut(gameId, expectedStart) {
  const game = await Games.findOneAsync(gameId);
  // Bail out if the timer has been reset (manual submit completed the turn) or
  // if a new timer instance was started for a later turn — without this check,
  // a stale setTimeout from a previous turn can auto-submit a player who still
  // has time on their current programming timer.
  if (
    game.timer !== 1 ||
    game.timerStartedAt == null ||
    game.timerStartedAt.getTime() !== expectedStart.getTime()
  ) {
    return;
  }
  console.log('time up! setting timer to 0');
  await Games.updateAsync(gameId, { $set: { timer: 0, timerStartedAt: null } });
  await new Promise((resolve) => Meteor.setTimeout(resolve, 2500));
  const cnt = await Players.find({ gameId, submitted: true }).countAsync();
  const playerCnt = await Players.find({ gameId, lives: { $gt: 0 } }).countAsync();
  if (cnt < playerCnt) {
    const unsubmittedPlayer = await Players.findOneAsync({ gameId, submitted: false });
    if (unsubmittedPlayer) {
      await CardLogic.submitCardsAsync(unsubmittedPlayer);
      console.log(`Player ${unsubmittedPlayer.name} did not respond, submitting random cards`);
    }
  }
}

async function verifySubmittedCardsAsync(player) {
  // check if all played cards are available from original hand...
  // Except locked cards, those are not in the hand.
  const availableCards = await player.getHandCardsAsync();
  const submittedCards = await player.getChosenCardsAsync();
  // compute notLockedCards inline to avoid sync DB call inside notLockedCards()
  const notLockedCnt = player.notLockedCnt();
  const notLockedCardsList =
    player.lockedCnt() === GameLogic.CARD_SLOTS ? [] : submittedCards.slice(0, notLockedCnt);

  // Phase 1: reserve every legally-programmed card. Placing a card in a register does
  // not remove it from the hand, so the hand still contains the programmed cards — a
  // single check-and-fill pass let the random draw for an earlier empty slot consume a
  // card programmed in a later slot, which was then evicted as "illegal". Reserving
  // first means the fills below only ever draw from the unprogrammed remainder.
  const legal = new Array(notLockedCardsList.length).fill(false);
  for (let i = 0; i < notLockedCardsList.length; i++) {
    const card = notLockedCardsList[i];
    if (card >= 0) {
      const handIndex = availableCards.indexOf(card);
      if (handIndex !== -1) {
        availableCards.splice(handIndex, 1);
        legal[i] = true;
      } else {
        console.warn(`illegal card detected: ${card}! (removing card)`);
      }
    } else {
      console.warn('Not enough cards submitted');
    }
  }

  // Phase 2: random-fill the empty and illegal slots from what remains.
  for (let i = 0; i < notLockedCardsList.length; i++) {
    if (legal[i]) continue;
    if (availableCards.length > 0) {
      // grab card from hand
      const cardIdFromHand = availableCards.splice(
        Math.floor(Math.random() * availableCards.length),
        1
      )[0];
      console.warn('Handing out random card', cardIdFromHand);
      submittedCards[i] = cardIdFromHand;
      player.cards[i] = CardLogic.RANDOM;
    } else {
      console.error(`No available cards to fill slot ${i}!`);
      submittedCards[i] = CardLogic.EMPTY;
      player.cards[i] = CardLogic.EMPTY;
    }
  }

  await Cards.updateAsync(
    { playerId: player._id },
    {
      $set: {
        handCards: availableCards,
        chosenCards: submittedCards,
      },
    }
  );
  return player.cards;
}

export class CardLogic {
  static _MAX_NUMBER_OF_CARDS = 9;
  static EMPTY = -1;
  static COVERED = -2;
  static DAMAGE = -3;
  static RANDOM = -4;

  static _cardTypes = {
    0: { direction: 2, position: 0, name: 'u-turn' },
    1: { direction: 1, position: 0, name: 'turn-right' },
    2: { direction: -1, position: 0, name: 'turn-left' },
    3: { direction: 0, position: -1, name: 'step-backward' },
    4: { direction: 0, position: 1, name: 'step-forward' },
    5: { direction: 0, position: 2, name: 'step-forward-2' },
    6: { direction: 0, position: 3, name: 'step-forward-3' },
  };

  static _8_deck = [
    6, // u turn
    18, // right turn
    18, // left turn
    6, // step back
    18, // step 1
    12, // step 2
    6, // step 3
  ];

  static _12_deck = [
    9, // u turn
    27, // right turn
    27, // left turn
    9, // step back
    27, // step 1
    18, // step 2
    9, // step 3
  ];

  static _option_deck = [
    [
      'superior_archive',
      "When reentering play after beeing destroyed, your robot doesn't receive the normal 20% damage",
    ],
    [
      'circuit_breaker',
      'If you have 30% or more damage at the end of your turn, your robot will begin the next turn powered down',
    ],
    [
      'rear-firing_laser',
      'Your robot has a rear-firing laser in addition to its main laser. This laser follows all the same rules as the main laser',
    ],
    ['extra_memory', 'You receive one extra Program card each turn.'],
    [
      'high-power_laser',
      "Your robot's main laser can shoot through one wall or robot to get to a target robot. If you shoot through a robot, that robot also receives full damage. You may use this Option with Fire Control and/or Double-Barreled Laser.",
    ],
    [
      'double-barreled_laser',
      'Whenever your robot fires its main laser, it fires two shots instead of one. You may use this Option with Fire Control and/or High-Power Laser.',
    ],
    [
      'ramming_gear',
      'Whenever your robot pushes or bumps into another robot, that robot receives 10% damage.',
    ],
    //    [ 'mechanical_arm', "Your robot can touch a flag or repair site from 1 space away (diagonally or orthogonally),
    //    as long as there isn't a wall."]
    ['ablative_coat', 'Absorbs the next 30% damage your robot receives.'],
    //###### choose to use
    // 'recompile'
    //[ 'power-down_shield', ""
    // 'abort_switch'
    //##### additional move options
    // 'fourth_gear'
    // 'reverse_gear'
    // 'crab_legs'
    // 'brakes'
    //####### register options
    // 'dual_processor'
    // 'conditional_program'
    // 'flywheel'
    //####### alternative laser
    // 'mini_howitzer'
    // 'fire_control'
    // 'radio_control'
    // [ 'scrambler',    "Whenever you could fire your main laser at a robot, you may instead fire the Scrambler. This replaces the target's robots's next programmed card with the top Program card from the deck. You can't use this Option on the fifth register phase."]
    // [ 'tractor_beam', "Whenever you could fire your main laser at a robot that isn't in an adjacent space, you may instead fire the Tractor Beam. This moves the target robot 1 space toward your robot."]
    // [ 'pressor_beam', "Whenever you could fire your main laser at a robot, you may instead fire the Pressor Beam. This moves the target robot 1 space away from your robot."]
    //#### activate before submit
    // 'gyroscopic_stabilizer'
  ];

  static async discardCardsAsync(game, player) {
    const deck = await game.getDeckAsync();

    const playerCards = await Cards.findOneAsync({ playerId: player._id });
    if (playerCards) {
      for (const unusedCard of playerCards.handCards) {
        if (unusedCard >= 0) {
          deck.cards.push(unusedCard);
        }
      }
      const { chosenCards } = playerCards;
      // compute notLockedCards inline using already-fetched chosenCards
      const notLockedCards =
        player.lockedCnt() === GameLogic.CARD_SLOTS
          ? []
          : chosenCards.slice(0, player.notLockedCnt());
      for (let i = 0; i < notLockedCards.length; i++) {
        // Rule note: You don't keep a discard pile. You always use the complete deck
        const discardCard = notLockedCards[i];
        if (discardCard >= 0) {
          deck.cards.push(discardCard);
        }
        player.cards[i] = this.EMPTY;
        chosenCards[i] = this.EMPTY;
      }

      await Players.updateAsync(player._id, {
        $set: {
          cards: player.cards,
          playedCardsCnt: 0,
          chosenCardsCnt: player.lockedCnt(),
        },
      });
      await Cards.updateAsync(
        { playerId: player._id },
        {
          $set: {
            handCards: [],
            chosenCards,
          },
        }
      );
    }

    console.log(`${player.name}: returned cards, new total: ${deck.cards.length}`);
    return await Deck.upsertAsync({ gameId: game._id }, deck);
  }

  static async dealCardsAsync(game, player) {
    const deck = await game.getDeckAsync();
    const handCards = [];

    //for every damage you get a card less
    let nrOfNewCards = this._MAX_NUMBER_OF_CARDS - player.damage;
    if (player.hasOptionCard('extra_memory')) {
      nrOfNewCards++;
    }
    //grab card from deck, so it can't be handed out twice
    for (let i = 0; i < nrOfNewCards; i++) {
      handCards.push(deck.cards.pop());
    }
    console.log(`${player.name}: hand cards ${handCards.length}, new total: ${deck.cards.length}`);

    await Cards.updateAsync(
      { playerId: player._id },
      {
        $set: {
          handCards,
        },
      }
    );
    return await Deck.updateAsync(deck._id, deck);
  }

  static async submitCardsAsync(player) {
    if (player.isPoweredDown()) {
      await Players.updateAsync(player._id, {
        $set: {
          submitted: true,
          damage: 0,
        },
      });
    } else {
      const approvedCards = await verifySubmittedCardsAsync(player);

      await Players.updateAsync(player._id, {
        $set: {
          submitted: true,
          optionalInstantPowerDown: false,
          cards: approvedCards,
        },
      });
    }

    const playerCnt = await Players.find({
      gameId: player.gameId,
      lives: { $gt: 0 },
    }).countAsync();
    const readyPlayerCnt = await Players.find({
      gameId: player.gameId,
      submitted: true,
      lives: { $gt: 0 },
    }).countAsync();
    if (readyPlayerCnt === playerCnt) {
      await Games.updateAsync(player.gameId, { $set: { timer: -1, timerStartedAt: null } });
      return await GameState.nextGamePhaseAsync(player.gameId);
    } else if (readyPlayerCnt === playerCnt - 1) {
      // start timer — capture timerStart so the scheduled callback can verify
      // it is still acting on the same timer instance when it fires
      const timerStart = new Date();
      await Games.updateAsync(player.gameId, { $set: { timer: 1, timerStartedAt: timerStart } });
      return Meteor.setTimeout(
        Meteor.bindEnvironment(() =>
          // Fire-and-forget, so the catch is load-bearing: without it a rejection here
          // becomes an unhandled promise rejection. It cannot recover, though — if this
          // throws, the last player is never force-submitted and the game sits in the
          // program phase indefinitely. The gameId is in the message because this log
          // line is the only trace such a game leaves.
          autoSubmitIfTimedOut(player.gameId, timerStart).catch(async (err) => {
            console.error(`autoSubmitIfTimedOut failed for game ${player.gameId}`, err);
            // Say so in the game chat: without this the turn simply stops and the
            // players have no idea why. Guarded because the most likely reason for
            // getting here is that the game no longer exists.
            try {
              const game = await Games.findOneAsync(player.gameId);
              await game?.chatAsync(
                'The programming timer failed — please submit your cards to continue.'
              );
            } catch (announceErr) {
              console.error(`could not announce timer failure for ${player.gameId}`, announceErr);
            }
          })
        ),
        GameLogic.TIMER * 1000
      );
    }
  }

  static getOptionName(index) {
    return this._option_deck[index][0];
  }

  static getOptionTitle(name) {
    return name
      .replace('/_/g', ' ')
      .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
  }

  static getOptionId(name) {
    for (let id = 0; id < this._option_deck.length; id++) {
      const option = this._option_deck[id];
      if (option[0] === name) {
        return id;
      }
    }
  }

  static getOptionDesc(name) {
    return this._option_deck[this.getOptionId(name)][1];
  }

  static cardType(cardId, playerCnt) {
    const deck = playerCnt <= 8 ? this._8_deck : this._12_deck;
    let cnt = 0;
    for (let index = 0; index < deck.length; index++) {
      const cardTypeCnt = deck[index];
      cnt += cardTypeCnt;
      if (cardId < cnt) {
        return this._cardTypes[index];
      }
    }
  }

  static priority(index) {
    return (index + 1) * 10;
  }
}
