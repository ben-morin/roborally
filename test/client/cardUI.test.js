// addUIData is the densest piece of presentation logic in the client: it turns raw card
// ids into the class/priority/type bags the Blaze card templates render, and it decides
// which cards look locked, chosen, or blank.
import { describe, expect, it } from 'vitest';
import { addUIData } from '../../client/lib/cardUI.ts';
import { CardLogic } from '../../both/cardlogic.ts';
import { GameLogic } from '../../both/gamelogic.ts';

// 8-player deck ranges (CardLogic._8_deck = [6,18,18,6,18,12,6]):
//   0-5 u-turn | 6-23 turn-right | 24-41 turn-left | 42-47 step-backward
//   48-65 step-forward | 66-77 step-forward-2 | 78-83 step-forward-3
const U_TURN = 0;
const TURN_RIGHT = 6;
const STEP_FORWARD = 48;
const STEP_3 = 78;

describe('sentinel cards', () => {
  it.each([
    ['empty', CardLogic.EMPTY],
    ['dmg', CardLogic.DAMAGE],
    ['covered', CardLogic.COVERED],
    ['random', CardLogic.RANDOM],
  ])('renders %s as a bare type with no class or priority', (type, cardId) => {
    const [ui] = addUIData([cardId], true, 0, false, 8);

    expect(ui).toEqual({ cardId, type });
  });

  it('gives a sentinel card a slot index when the row is selectable', () => {
    const ui = addUIData([CardLogic.EMPTY, CardLogic.EMPTY], false, 0, true, 8);

    expect(ui.map((c) => c.slot)).toEqual([0, 1]);
  });
});

describe('real cards', () => {
  it('maps each card id to its type and priority', () => {
    const ui = addUIData([U_TURN, TURN_RIGHT, STEP_FORWARD, STEP_3], false, 0, false, 8);

    expect(ui.map((c) => c.type)).toEqual([
      'u-turn',
      'turn-right',
      'step-forward',
      'step-forward-3',
    ]);
    // priority(index) === (index + 1) * 10, i.e. the card id *is* the priority order.
    expect(ui.map((c) => c.priority)).toEqual([10, 70, 490, 790]);
  });

  it('reads the twelve-player deck when the game seats more than eight', () => {
    // Card 7 sits in turn-right for an 8-player deck but still inside u-turn for the
    // larger one, so the player count genuinely changes what gets rendered.
    expect(addUIData([7], false, 0, false, 8)[0].type).toBe('turn-right');
    expect(addUIData([7], false, 0, false, 12)[0].type).toBe('u-turn');
  });

  it("marks hand cards 'available' and played cards 'played'", () => {
    expect(addUIData([U_TURN], true, 0, false, 8)[0].class).toBe('available');
    expect(addUIData([U_TURN], false, 0, false, 8)[0].class).toBe('played');
  });

  it('falls back to an empty card and warns for an id outside the deck', () => {
    // 84 is one past the end of the 8-player deck, so cardType() returns undefined.
    const [ui] = addUIData([84], false, 0, false, 8);

    expect(ui.type).toBe('empty');
    expect(ui.class).toBeUndefined();
    expect(ui.priority).toBeUndefined();
  });

  it('skips undefined and null entries entirely, leaving a bag with only the id', () => {
    const ui = addUIData([undefined, null], false, 0, false, 8);

    expect(ui).toEqual([{ cardId: undefined }, { cardId: null }]);
  });
});

describe('locked slots', () => {
  const register = [U_TURN, U_TURN, U_TURN, U_TURN, U_TURN];

  it('locks the trailing slots, counting back from the last register', () => {
    const ui = addUIData(register, false, 2, false, 8);

    expect(ui.map((c) => Boolean(c.locked))).toEqual([false, false, false, true, true]);
    expect(ui[3].class).toBe('played locked');
    expect(ui[0].class).toBe('played');
  });

  it('locks nothing when the damage count is zero or false', () => {
    for (const locked of [0, false]) {
      const ui = addUIData(register, false, locked, false, 8);
      expect(ui.some((c) => c.locked)).toBe(false);
    }
  });

  it('locks every slot once damage reaches the register size', () => {
    const ui = addUIData(register, false, GameLogic.CARD_SLOTS, false, 8);

    expect(ui.every((c) => c.locked)).toBe(true);
  });
});

describe('cards already placed in a register', () => {
  it('greys out a hand card whose id is already chosen', () => {
    const chosen = new Set([TURN_RIGHT]);

    const ui = addUIData([U_TURN, TURN_RIGHT], true, 0, false, 8, chosen);

    expect(ui[0].chosen).toBeUndefined();
    expect(ui[0].class).toBe('available');
    expect(ui[1].chosen).toBe(true);
    expect(ui[1].class).toBe('available chosen');
  });

  it('never marks a played row as chosen, even when the id is in the set', () => {
    // The `available &&` guard matters: the register itself holds the chosen cards, so
    // greying them out there would grey out the whole row.
    const ui = addUIData([TURN_RIGHT], false, 0, false, 8, new Set([TURN_RIGHT]));

    expect(ui[0].chosen).toBeUndefined();
    expect(ui[0].class).toBe('played');
  });

  it('combines locked and chosen on the same card', () => {
    const ui = addUIData([U_TURN, TURN_RIGHT], true, 1, false, 8, new Set([TURN_RIGHT]));

    // CARD_SLOTS(5) - locked(1) = 4, so only index >= 4 locks — index 1 does not.
    expect(ui[1].class).toBe('available chosen');

    const full = addUIData(Array(5).fill(TURN_RIGHT), true, 1, false, 8, new Set([TURN_RIGHT]));
    expect(full[4].class).toBe('available locked chosen');
  });
});

describe('shape', () => {
  it('returns one bag per input card, in order, and never mutates the input', () => {
    const cards = [U_TURN, CardLogic.EMPTY, STEP_FORWARD];
    const before = [...cards];

    const ui = addUIData(cards, true, 0, true, 8);

    expect(ui).toHaveLength(3);
    expect(ui.map((c) => c.cardId)).toEqual(before);
    expect(cards).toEqual(before);
  });

  it('returns an empty list for an empty register', () => {
    expect(addUIData([], true, 0, true, 8)).toEqual([]);
  });
});
