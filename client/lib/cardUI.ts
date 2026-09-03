// Pure presentation logic: turns a list of card ids into the property bags the Blaze
// card templates render. No Blaze, no Meteor, no DOM — lifted out of
// client/views/cards/cards.js so it can be tested directly.
import { CardLogic } from '../../both/cardlogic.ts';
import { GameLogic } from '../../both/gamelogic.ts';

// One bag per card. Everything but `cardId` is conditional, which is what makes the rest
// optional — a template reads what its own case put there.
interface UICard {
  cardId: number;
  slot?: number;
  type?: string;
  class?: string;
  priority?: number;
  locked?: boolean;
  chosen?: boolean;
}

// What the three booleans decide, since their types cannot say it: `available` is the hand
// (clickable) rather than played or chosen cards, `selectable` attaches the slot index so a
// click knows which slot it hit, and `numberOfPlayers` picks the deck CardLogic.cardType()
// reads.
export function addUIData(
  cards: number[],
  available: boolean,
  locked: number | false,
  selectable: boolean,
  numberOfPlayers: number,
  chosenIds?: Set<number>
) {
  const uiCards: UICard[] = [];
  cards.forEach((card, i) => {
    const cardProp: UICard = {
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
