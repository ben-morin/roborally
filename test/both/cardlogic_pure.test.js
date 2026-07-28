import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { CardLogic } from '../../both/cardlogic.js';

beforeEach(() => resetFakeCollections());

describe('deck composition', () => {
  it('the 8-player deck has 84 cards, matching the sum of its type counts', () => {
    const deckSpec = [6, 18, 18, 6, 18, 12, 6];
    expect(deckSpec.reduce((a, b) => a + b, 0)).toBe(84);
    // cardType(id, 8) should classify every id 0..83 and nothing beyond
    for (let id = 0; id < 84; id++) {
      expect(CardLogic.cardType(id, 8)).toBeDefined();
    }
    expect(CardLogic.cardType(84, 8)).toBeUndefined();
  });

  it('the 12-player deck has 126 cards', () => {
    const deckSpec = [9, 27, 27, 9, 27, 18, 9];
    expect(deckSpec.reduce((a, b) => a + b, 0)).toBe(126);
    for (let id = 0; id < 126; id++) {
      expect(CardLogic.cardType(id, 12)).toBeDefined();
    }
    expect(CardLogic.cardType(126, 12)).toBeUndefined();
  });

  it('playerCnt <= 8 uses the 8-player deck (84 cards); > 8 uses the 12-player deck (126 cards) — boundary is exactly 8', () => {
    // id 84 only exists in the (bigger) 12-player deck; playerCnt 8 is still the
    // smaller deck, playerCnt 9 already switches over.
    expect(CardLogic.cardType(84, 8)).toBeUndefined();
    expect(CardLogic.cardType(84, 9)).toEqual({ direction: 0, position: 1, name: 'step-forward' });
    // the two decks also classify the SAME low id differently once past u-turn,
    // since the 12-deck's turn-right band (9-35) is wider than the 8-deck's (6-23)
    expect(CardLogic.cardType(10, 8).name).toBe('turn-right');
    expect(CardLogic.cardType(10, 12).name).toBe('turn-right');
    expect(CardLogic.cardType(7, 8).name).toBe('turn-right'); // 8-deck: turn-right starts at 6
    expect(CardLogic.cardType(7, 12).name).toBe('u-turn'); // 12-deck: u-turn runs 0-8
  });

  it('classifies every 8-player card id into contiguous ranges, in the documented card order', () => {
    const ranges8 = [
      [0, 6, 'u-turn'],
      [6, 24, 'turn-right'],
      [24, 42, 'turn-left'],
      [42, 48, 'step-backward'],
      [48, 66, 'step-forward'],
      [66, 78, 'step-forward-2'],
      [78, 84, 'step-forward-3'],
    ];
    for (const [start, end, name] of ranges8) {
      for (const id of [start, end - 1]) {
        expect(CardLogic.cardType(id, 8).name, `card ${id}`).toBe(name);
      }
    }
  });

  it('classifies every 12-player card id into contiguous ranges', () => {
    const ranges12 = [
      [0, 9, 'u-turn'],
      [9, 36, 'turn-right'],
      [36, 63, 'turn-left'],
      [63, 72, 'step-backward'],
      [72, 99, 'step-forward'],
      [99, 117, 'step-forward-2'],
      [117, 126, 'step-forward-3'],
    ];
    for (const [start, end, name] of ranges12) {
      for (const id of [start, end - 1]) {
        expect(CardLogic.cardType(id, 12).name, `card ${id}`).toBe(name);
      }
    }
  });

  it('cardType direction/position fields match the documented card behaviour', () => {
    expect(CardLogic.cardType(0, 8)).toEqual({ direction: 2, position: 0, name: 'u-turn' });
    expect(CardLogic.cardType(6, 8)).toEqual({ direction: 1, position: 0, name: 'turn-right' });
    expect(CardLogic.cardType(24, 8)).toEqual({ direction: -1, position: 0, name: 'turn-left' });
    expect(CardLogic.cardType(42, 8)).toEqual({
      direction: 0,
      position: -1,
      name: 'step-backward',
    });
    expect(CardLogic.cardType(48, 8)).toEqual({ direction: 0, position: 1, name: 'step-forward' });
    expect(CardLogic.cardType(66, 8)).toEqual({
      direction: 0,
      position: 2,
      name: 'step-forward-2',
    });
    expect(CardLogic.cardType(78, 8)).toEqual({
      direction: 0,
      position: 3,
      name: 'step-forward-3',
    });
  });
});

describe('priority', () => {
  it('is 10x (index + 1), so higher card ids always resolve first (characterization: matches deck ordering, not a random-priority draw)', () => {
    expect(CardLogic.priority(0)).toBe(10);
    expect(CardLogic.priority(1)).toBe(20);
    expect(CardLogic.priority(125)).toBe(1260);
  });
});

describe('option deck', () => {
  it('getOptionName/getOptionId round-trip, and getOptionDesc looks the id up again', () => {
    const total = 8; // number of implemented options in `_option_deck`
    for (let id = 0; id < total; id++) {
      const name = CardLogic.getOptionName(id);
      expect(CardLogic.getOptionId(name)).toBe(id);
      expect(CardLogic.getOptionDesc(name)).toBeTypeOf('string');
    }
    expect(CardLogic.getOptionId('not-a-real-option')).toBeUndefined();
  });

  it('getOptionTitle title-cases the name but does not actually replace underscores (characterization: literal string, not a regex)', () => {
    // `.replace('/_/g', ' ')` is a *string* search for the literal text "/_/g", which
    // never appears in an option name — so underscores survive untouched. Only the
    // second `.replace(/\w\S*/g, ...)` (word-capitalization) actually runs.
    expect(CardLogic.getOptionTitle('rear-firing_laser')).toBe('Rear-firing_laser');
    expect(CardLogic.getOptionTitle('extra_memory')).toBe('Extra_memory');
  });
});

describe('constants', () => {
  it('exposes the card-slot sentinel values used throughout the collections layer', () => {
    expect(CardLogic.EMPTY).toBe(-1);
    expect(CardLogic.COVERED).toBe(-2);
    expect(CardLogic.DAMAGE).toBe(-3);
    expect(CardLogic.RANDOM).toBe(-4);
    expect(CardLogic._MAX_NUMBER_OF_CARDS).toBe(9);
  });
});
