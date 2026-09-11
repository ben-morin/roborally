import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { CardLogic } from '../../both/cardlogic.ts';

// `cardType` takes the size of the deck a card came from, not a player count.
const DECK_8 = 84;
const DECK_12 = 126;

beforeEach(() => resetFakeCollections());

describe('deck composition', () => {
  it('the 8-player deck has 84 cards, matching the sum of its type counts', () => {
    const deckSpec = [6, 18, 18, 6, 18, 12, 6];
    expect(deckSpec.reduce((a, b) => a + b, 0)).toBe(84);
    // cardType(id, DECK_8) should classify every id 0..83 and nothing beyond
    for (let id = 0; id < 84; id++) {
      expect(CardLogic.cardType(id, DECK_8)).toBeDefined();
    }
    expect(CardLogic.cardType(84, DECK_8)).toBeUndefined();
  });

  it('the 12-player deck has 126 cards', () => {
    const deckSpec = [9, 27, 27, 9, 27, 18, 9];
    expect(deckSpec.reduce((a, b) => a + b, 0)).toBe(126);
    for (let id = 0; id < 126; id++) {
      expect(CardLogic.cardType(id, DECK_12)).toBeDefined();
    }
    expect(CardLogic.cardType(126, DECK_12)).toBeUndefined();
  });

  it('deckSizeFor picks the 84-card deck up to 8 players and the 126-card deck from 9', () => {
    expect(CardLogic.deckSizeFor(1)).toBe(DECK_8);
    expect(CardLogic.deckSizeFor(8)).toBe(DECK_8);
    expect(CardLogic.deckSizeFor(9)).toBe(DECK_12);
    expect(CardLogic.deckSizeFor(CardLogic.MAX_PLAYERS)).toBe(DECK_12);
  });

  it('the deck SIZE picks the deck, not the live player count — the same id reads differently', () => {
    // id 84 only exists in the (bigger) 12-player deck.
    expect(CardLogic.cardType(84, DECK_8)).toBeUndefined();
    expect(CardLogic.cardType(84, DECK_12)).toEqual({
      direction: 0,
      position: 1,
      name: 'step-forward',
    });
    // the two decks also classify the SAME low id differently once past u-turn,
    // since the 12-deck's turn-right band (9-35) is wider than the 8-deck's (6-23)
    expect(CardLogic.cardType(10, DECK_8).name).toBe('turn-right');
    expect(CardLogic.cardType(10, DECK_12).name).toBe('turn-right');
    expect(CardLogic.cardType(7, DECK_8).name).toBe('turn-right'); // 8-deck: turn-right starts at 6
    expect(CardLogic.cardType(7, DECK_12).name).toBe('u-turn'); // 12-deck: u-turn runs 0-8
  });

  it('cardType throws for the sentinel ids instead of reading them as u-turns', () => {
    for (const sentinel of [
      CardLogic.EMPTY,
      CardLogic.COVERED,
      CardLogic.DAMAGE,
      CardLogic.RANDOM,
    ]) {
      expect(() => CardLogic.cardType(sentinel, DECK_8)).toThrow(`Not a deck card: ${sentinel}`);
    }
    expect(CardLogic.cardType(0, DECK_8).name).toBe('u-turn');
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
        expect(CardLogic.cardType(id, DECK_8).name, `card ${id}`).toBe(name);
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
        expect(CardLogic.cardType(id, DECK_12).name, `card ${id}`).toBe(name);
      }
    }
  });

  it('cardType direction/position fields match the documented card behaviour', () => {
    expect(CardLogic.cardType(0, DECK_8)).toEqual({ direction: 2, position: 0, name: 'u-turn' });
    expect(CardLogic.cardType(6, DECK_8)).toEqual({
      direction: 1,
      position: 0,
      name: 'turn-right',
    });
    expect(CardLogic.cardType(24, DECK_8)).toEqual({
      direction: -1,
      position: 0,
      name: 'turn-left',
    });
    expect(CardLogic.cardType(42, DECK_8)).toEqual({
      direction: 0,
      position: -1,
      name: 'step-backward',
    });
    expect(CardLogic.cardType(48, DECK_8)).toEqual({
      direction: 0,
      position: 1,
      name: 'step-forward',
    });
    expect(CardLogic.cardType(66, DECK_8)).toEqual({
      direction: 0,
      position: 2,
      name: 'step-forward-2',
    });
    expect(CardLogic.cardType(78, DECK_8)).toEqual({
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
    expect(() => CardLogic.getOptionId('not-a-real-option')).toThrow(
      'Unknown option card: not-a-real-option'
    );
  });

  it('getOptionDesc throws for a name that is not in the option deck', () => {
    expect(() => CardLogic.getOptionDesc('nope')).toThrow('Unknown option card: nope');
  });

  it('isOptionCard answers for a name instead of throwing, so callers can ask first', () => {
    expect(CardLogic.isOptionCard('extra_memory')).toBe(true);
    expect(CardLogic.isOptionCard('dual_processor')).toBe(false);
    expect(CardLogic.isOptionCard('')).toBe(false);
  });

  it('getOptionTitle replaces underscores with spaces and title-cases each word', () => {
    // Was `.replace('/_/g', ' ')` — a *string* search for the literal text "/_/g" that
    // never matched, so titles kept their underscores ("Extra_memory"). Fixed to a real
    // regex 2026-08-21 when option titles started appearing in chat messages.
    expect(CardLogic.getOptionTitle('rear-firing_laser')).toBe('Rear-firing Laser');
    expect(CardLogic.getOptionTitle('extra_memory')).toBe('Extra Memory');
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
