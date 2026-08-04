// Slot cycling: after a card is clicked into a register, the selection jumps to the next
// free slot, wrapping around. Fiddly enough to be worth pinning precisely.
import { describe, expect, it } from 'vitest';
import { firstEmptySlot, nextEmptySlot } from '../../client/lib/slots.js';
import { CardLogic } from '../../both/cardlogic.js';

const E = CardLogic.EMPTY;
const C = 7; // any real card id

describe('firstEmptySlot', () => {
  it('finds the lowest empty slot', () => {
    expect(firstEmptySlot([E, E, E, E, E])).toBe(0);
    expect(firstEmptySlot([C, E, E, E, E])).toBe(1);
    expect(firstEmptySlot([C, C, C, C, E])).toBe(4);
  });

  it('skips filled slots to reach a later gap', () => {
    expect(firstEmptySlot([C, C, E, C, E])).toBe(2);
  });

  it('returns 0 when the register is full', () => {
    expect(firstEmptySlot([C, C, C, C, C])).toBe(0);
  });
});

describe('nextEmptySlot', () => {
  it('advances to the next empty slot', () => {
    expect(nextEmptySlot([C, E, E, E, E], 0)).toBe(1);
    expect(nextEmptySlot([E, E, E, E, E], 2)).toBe(3);
  });

  it('skips slots that are already filled', () => {
    expect(nextEmptySlot([E, C, C, E, E], 0)).toBe(3);
  });

  it('wraps past the end of the register', () => {
    expect(nextEmptySlot([E, C, C, C, C], 3)).toBe(0);
    expect(nextEmptySlot([C, E, C, C, C], 4)).toBe(1);
  });

  it('returns 0 when no other slot is free', () => {
    expect(nextEmptySlot([C, C, C, C, C], 2)).toBe(0);
  });

  // The scan runs currentSlot+1 .. currentSlot+CARD_SLOTS-1, so it stops one short of
  // coming back round to where it started. A register whose only gap is the current slot
  // therefore reports 0 rather than that slot.
  it('does not return the current slot even when it is the only empty one', () => {
    expect(nextEmptySlot([C, C, E, C, C], 2)).toBe(0);
  });
});
