// The one draw a Player makes on its own: a powered-down robot whose new damage locks a
// slot takes that slot's card straight off the deck. Pinned here because the deck cannot
// run out in a real game, so the guard has no other cover.
import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { GameLogic } from '../../both/gamelogic.ts';
import { Decks } from '../../collections/deck.ts';
import { insertGame, insertPlayer, insertCards, insertDeck } from '../helpers/fixtures.js';

beforeEach(() => resetFakeCollections());

describe('discardOptionCardAsync', () => {
  it('drops a card whose name has left the option deck, leaving the pile alone', async () => {
    const game = await insertGame();
    // A name no longer in the catalogue, as a game already in flight would still hold.
    const player = await insertPlayer(game._id, { optionCards: { dual_processor: true } });
    await insertDeck(game._id, { optionCards: [], discardedOptionCards: [] });

    await player.discardOptionCardAsync('dual_processor');

    expect(player.optionCards).toEqual({});
    const deck = await Decks.findOneAsync({ gameId: game._id });
    expect(deck.discardedOptionCards).toEqual([]);
  });

  it('discards a card the deck still has by its id', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id, { optionCards: { extra_memory: true } });
    await insertDeck(game._id, { optionCards: [], discardedOptionCards: [] });

    await player.discardOptionCardAsync('extra_memory');

    const deck = await Decks.findOneAsync({ gameId: game._id });
    expect(deck.discardedOptionCards).toEqual(['extra_memory']);
  });
});

describe('addDamageAsync', () => {
  it('throws when a newly locked slot has no card left to draw', async () => {
    const game = await insertGame();
    // damage 4 -> 5 locks the first slot, and a powered-down robot has no hand to fill it
    const player = await insertPlayer(game._id, { powerState: GameLogic.OFF, damage: 4 });
    await insertCards(player._id, game._id);
    await insertDeck(game._id, { cards: [] });

    await expect(player.addDamageAsync(1)).rejects.toThrow(`Deck exhausted for game ${game._id}`);
  });
});
