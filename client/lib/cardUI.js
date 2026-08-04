// Pure presentation logic: turns a list of card ids into the property bags the Blaze
// card templates render. No Blaze, no Meteor, no DOM — lifted out of
// client/views/cards/cards.js so it can be tested directly.
import { CardLogic } from '../../both/cardlogic.js';
import { GameLogic } from '../../both/gamelogic.js';

/**
 * @param cards           card ids, in slot order
 * @param available       true for the hand (clickable), false for played/chosen cards
 * @param locked          how many trailing slots damage has locked (0/false for none)
 * @param selectable      attach the slot index, so a click knows which slot it hit
 * @param numberOfPlayers decides which deck CardLogic.cardType() reads
 * @param chosenIds       Set of card ids already placed in a slot, greyed out in the hand
 */
export function addUIData(cards, available, locked, selectable, numberOfPlayers, chosenIds) {
  const uiCards = [];
  cards.forEach((card, i) => {
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
