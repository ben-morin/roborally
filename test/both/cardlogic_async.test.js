import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { insertGame, insertPlayer, insertCards, insertDeck } from '../helpers/fixtures.js';
import { CardLogic } from '../../both/cardlogic.js';
import { GameLogic } from '../../both/gamelogic.js';
import { GameState } from '../../both/gamestate.js';
import { Games } from '../../collections/games.js';
import { Players } from '../../collections/players.js';
import { Cards } from '../../collections/cards.js';
import { Deck } from '../../collections/deck.js';

beforeEach(() => resetFakeCollections());
afterEach(() => vi.restoreAllMocks());

describe('dealCardsAsync', () => {
  it('deals _MAX_NUMBER_OF_CARDS - damage cards, popped off the END of the deck', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id, { damage: 2 });
    await insertCards(player._id, game._id);
    await insertDeck(game._id, { cards: Array.from({ length: 20 }, (_, i) => i) }); // 0..19

    await CardLogic.dealCardsAsync(game, player);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.handCards).toEqual([19, 18, 17, 16, 15, 14, 13]); // 9 - 2 = 7 cards
    const deckDoc = await Deck.findOneAsync({ gameId: game._id });
    expect(deckDoc.cards).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('deals one extra card with the extra_memory option', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id, { damage: 0, optionCards: { extra_memory: true } });
    await insertCards(player._id, game._id);
    await insertDeck(game._id, { cards: Array.from({ length: 20 }, (_, i) => i) });

    await CardLogic.dealCardsAsync(game, player);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.handCards).toHaveLength(10); // 9 + 1
  });

  it('deals nothing when damage already meets or exceeds the max hand size', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id, { damage: 9 });
    await insertCards(player._id, game._id);
    await insertDeck(game._id, { cards: [1, 2, 3] });

    await CardLogic.dealCardsAsync(game, player);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.handCards).toEqual([]);
    const deckDoc = await Deck.findOneAsync({ gameId: game._id });
    expect(deckDoc.cards).toEqual([1, 2, 3]); // untouched
  });
});

describe('discardCardsAsync', () => {
  it('returns unused hand cards and not-locked chosen cards to the deck, resetting those slots', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id, { damage: 0, cards: [1, 2, 3, 4, 5] });
    await insertCards(player._id, game._id, {
      handCards: [1, 2, 3],
      chosenCards: [10, 11, -1, -1, -1],
    });
    await insertDeck(game._id, { cards: [500] });

    await CardLogic.discardCardsAsync(game, player);

    const deckDoc = await Deck.findOneAsync({ gameId: game._id });
    expect([...deckDoc.cards].sort((a, b) => a - b)).toEqual([1, 2, 3, 10, 11, 500]);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.handCards).toEqual([]);
    expect(cardsDoc.chosenCards).toEqual([-1, -1, -1, -1, -1]);

    const playerDoc = await Players.findOneAsync(player._id);
    expect(playerDoc.cards).toEqual([-1, -1, -1, -1, -1]);
    expect(playerDoc.playedCardsCnt).toBe(0);
    expect(playerDoc.chosenCardsCnt).toBe(0);
  });

  it('leaves cards locked by damage untouched (characterization of the "locked slot" rule)', async () => {
    const game = await insertGame();
    // lockedCnt() = max(0, CARD_SLOTS + damage - _MAX_NUMBER_OF_CARDS) = max(0, 5+5-9) = 1
    const player = await insertPlayer(game._id, {
      damage: 5,
      cards: [1, 2, 3, 4, CardLogic.COVERED],
    });
    await insertCards(player._id, game._id, {
      handCards: [],
      chosenCards: [-1, -1, -1, -1, 99], // slot 4 ("locked") holds card 99
    });
    await insertDeck(game._id, { cards: [] });

    await CardLogic.discardCardsAsync(game, player);

    const deckDoc = await Deck.findOneAsync({ gameId: game._id });
    expect(deckDoc.cards).not.toContain(99); // the locked card never returns to the deck

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.chosenCards).toEqual([-1, -1, -1, -1, 99]); // locked slot preserved

    const playerDoc = await Players.findOneAsync(player._id);
    expect(playerDoc.cards).toEqual([-1, -1, -1, -1, CardLogic.COVERED]); // locked slot preserved
    expect(playerDoc.chosenCardsCnt).toBe(1); // === lockedCnt()
  });

  it('is a no-op (besides logging) when the player has no Cards doc yet', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id);
    await insertDeck(game._id, { cards: [7] });

    await expect(CardLogic.discardCardsAsync(game, player)).resolves.not.toThrow();
    const deckDoc = await Deck.findOneAsync({ gameId: game._id });
    expect(deckDoc.cards).toEqual([7]);
  });
});

describe('submitCardsAsync', () => {
  it('a powered-down player is submitted with damage reset to 0, without touching their cards', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id, { powerState: GameLogic.OFF, damage: 4 });
    const other = await insertPlayer(game._id); // keeps readyPlayerCnt below playerCnt
    await insertCards(player._id, game._id, { handCards: [1], chosenCards: [1, -1, -1, -1, -1] });

    await CardLogic.submitCardsAsync(player);

    const playerDoc = await Players.findOneAsync(player._id);
    expect(playerDoc.submitted).toBe(true);
    expect(playerDoc.damage).toBe(0);
    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.chosenCards).toEqual([1, -1, -1, -1, -1]); // untouched
    void other;
  });

  it('replaces an illegal (not-in-hand) card with a random one from the remaining hand, and force-fills unsubmitted slots (characterization)', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id, { damage: 0, cards: [0, 0, 0, 0, 0] });
    const other = await insertPlayer(game._id);
    // Only slot 0 was "submitted" (with a card not actually in hand); slots 1-4 are
    // still CardLogic.EMPTY, as if the player never finished programming.
    await insertCards(player._id, game._id, {
      handCards: [42],
      chosenCards: [999, -1, -1, -1, -1],
    });

    await CardLogic.submitCardsAsync(player);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    // The only hand card (42) is deterministically picked to replace slot 0 — with a
    // single-card hand there's no randomness in *which* card gets picked.
    expect(cardsDoc.chosenCards[0]).toBe(42);
    expect(cardsDoc.handCards).toEqual([]); // the one hand card got consumed
    // Slots 1-4 had no hand cards left to fill them with, so they come back EMPTY.
    expect(cardsDoc.chosenCards.slice(1)).toEqual([-1, -1, -1, -1]);

    const playerDoc = await Players.findOneAsync(player._id);
    expect(playerDoc.cards[0]).toBe(CardLogic.RANDOM);
    expect(playerDoc.cards.slice(1)).toEqual([-1, -1, -1, -1]);
    void other;
  });

  it('passes exactly-in-hand submitted cards through untouched', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id, { damage: 0, cards: [9, 9, 9, 9, 9] });
    const other = await insertPlayer(game._id);
    await insertCards(player._id, game._id, {
      handCards: [1, 2, 3],
      chosenCards: [3, 2, 1, -1, -1],
    });

    await CardLogic.submitCardsAsync(player);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.chosenCards.slice(0, 3)).toEqual([3, 2, 1]);
    const playerDoc = await Players.findOneAsync(player._id);
    // legal cards never touch `player.cards` — it's only overwritten on the
    // illegal/random-fill path.
    expect(playerDoc.cards[0]).toBe(9);
    void other;
  });

  it('starts the auto-submit timer when exactly one player is left unsubmitted, and that timer force-submits them', async () => {
    vi.useFakeTimers();
    const game = await insertGame();
    const first = await insertPlayer(game._id, { name: 'first' });
    const last = await insertPlayer(game._id, { name: 'last', damage: 0 });
    await insertCards(first._id, game._id, { handCards: [], chosenCards: [1, 2, 3, 4, 5] });
    await insertCards(last._id, game._id, { handCards: [], chosenCards: [-1, -1, -1, -1, -1] });
    // Once the timer force-submits `last`, every living player has submitted, which
    // would otherwise cascade into a full GameState phase-machine run — out of scope
    // for this test, so stub the phase transition and just assert it gets triggered.
    const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();

    await CardLogic.submitCardsAsync(first);

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.timer).toBe(1);
    expect(gameDoc.timerStartedAt).toBeInstanceOf(Date);

    // GameLogic.TIMER (30s) for the countdown, then the fixed 2500ms grace delay
    // inside autoSubmitIfTimedOut before it force-submits.
    await vi.advanceTimersByTimeAsync(GameLogic.TIMER * 1000 + 2500 + 10);

    const lastDoc = await Players.findOneAsync(last._id);
    expect(lastDoc.submitted).toBe(true);
    // last's forced submit makes readyPlayerCnt === playerCnt, so the phase advances.
    expect(nextPhase).toHaveBeenCalledWith(game._id);

    vi.useRealTimers();
  });

  it('resets the timer and advances the game phase once every living player has submitted', async () => {
    const game = await insertGame({ timer: 1, timerStartedAt: new Date() });
    const player = await insertPlayer(game._id);
    await insertCards(player._id, game._id, { handCards: [], chosenCards: [1, 2, 3, 4, 5] });
    const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();

    await CardLogic.submitCardsAsync(player);

    expect(nextPhase).toHaveBeenCalledWith(game._id);
    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.timer).toBe(-1);
    expect(gameDoc.timerStartedAt).toBeNull();
  });

  it('a dead (0-lives) player never counts toward playerCnt/readyPlayerCnt', async () => {
    const game = await insertGame();
    const player = await insertPlayer(game._id);
    const dead = await insertPlayer(game._id, { lives: 0, submitted: false });
    await insertCards(player._id, game._id, { handCards: [], chosenCards: [1, 2, 3, 4, 5] });
    const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();

    await CardLogic.submitCardsAsync(player);

    // only `player` is alive, and they just submitted -> readyPlayerCnt === playerCnt
    expect(nextPhase).toHaveBeenCalledWith(game._id);
    void dead;
  });
});
