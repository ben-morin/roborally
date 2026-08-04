// Which register slot the next clicked card should go into. Pure functions over the
// chosen-cards array — lifted out of client/views/cards/cards.js, where they used to read
// the Cards collection directly and so could only be exercised through a live template.
import { CardLogic } from '../../both/cardlogic.js';
import { GameLogic } from '../../both/gamelogic.js';

/** Lowest empty slot, or 0 when the register is full. */
export function firstEmptySlot(chosenCards) {
  for (let i = 0; i < GameLogic.CARD_SLOTS; i++) {
    if (chosenCards[i] === CardLogic.EMPTY) {
      return i;
    }
  }
  return 0;
}

/**
 * Next empty slot after `currentSlot`, wrapping around the register. Returns 0 when no
 * other slot is free — including when `currentSlot` itself is the only empty one, since
 * the scan deliberately stops before coming back round to it.
 */
export function nextEmptySlot(chosenCards, currentSlot) {
  for (let j = currentSlot + 1; j < currentSlot + GameLogic.CARD_SLOTS; j++) {
    const k = j % GameLogic.CARD_SLOTS;
    if (chosenCards[k] === CardLogic.EMPTY) {
      return k;
    }
  }
  return 0;
}
