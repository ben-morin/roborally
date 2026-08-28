import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { insertGame, insertPlayer, insertCards, insertDeck } from '../helpers/fixtures.js';
import { autoSubmitIfTimedOut, CardLogic } from '../../both/cardlogic.js';
import { GameLogic } from '../../both/gamelogic.js';
import { GameState } from '../../both/gamestate.js';
import { Games } from '../../collections/games.js';
import { Players } from '../../collections/players.js';
import { Cards } from '../../collections/cards.js';
import { Chat } from '../../collections/chat.js';
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
    // The exhausted-hand branch is a genuine "shouldn't happen" — a full hand always
    // covers the unlocked slots exactly — so it reports through console.error, which
    // both/logging.js leaves live in production. Assert on it rather than letting it
    // print: it is the only signal this path produces, and it belongs in the test
    // rather than in the suite's output.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
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

    // One card in hand fills slot 0, leaving nothing for slots 1-4.
    expect(errors.mock.calls.map(([msg]) => msg)).toEqual([
      'No available cards to fill slot 1!',
      'No available cards to fill slot 2!',
      'No available cards to fill slot 3!',
      'No available cards to fill slot 4!',
    ]);

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

  // Regression: placing a card in a register does not remove it from the hand, so the
  // old single-pass verify let the random draw for an earlier EMPTY slot consume a card
  // programmed in a LATER slot — which was then evicted as "illegal" and replaced.
  // Observed live: program [-1, -1, 2, -1, -1], the slot-1 draw took card 2 out of the
  // hand, and the player's own pick got logged as `illegal card detected: 2!`.
  it('never steals a programmed card to random-fill an earlier empty slot', async () => {
    // Math.random pinned to 0 makes every draw take the first card of the pool — with
    // the programmed card first in hand, the old code stole it deterministically.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      damage: 0,
      cards: [-1, -1, CardLogic.COVERED, -1, -1],
    });
    const other = await insertPlayer(game._id); // keeps readyPlayerCnt below playerCnt
    await insertCards(player._id, game._id, {
      handCards: [2, 28, 76, 60, 10, 55],
      chosenCards: [-1, -1, 2, -1, -1],
    });

    await CardLogic.submitCardsAsync(player);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    // The player's pick stays in its register; the reserved card is never drawn, so
    // the four fills take the rest of the hand in order (Math.random = 0).
    expect(cardsDoc.chosenCards).toEqual([28, 76, 2, 60, 10]);
    expect(cardsDoc.handCards).toEqual([55]);

    const playerDoc = await Players.findOneAsync(player._id);
    // Slot 2 keeps its covered back — it was not re-marked as randomly assigned.
    expect(playerDoc.cards).toEqual([
      CardLogic.RANDOM,
      CardLogic.RANDOM,
      CardLogic.COVERED,
      CardLogic.RANDOM,
      CardLogic.RANDOM,
    ]);
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

  it('contains a failure inside the auto-submit timer instead of rejecting, and names the game', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const game = await insertGame();
    const first = await insertPlayer(game._id, { name: 'first' });
    const last = await insertPlayer(game._id, { name: 'last' });
    // A legal submission: every chosen card is actually in hand, so this half of the
    // test contributes no console.error of its own.
    await insertCards(first._id, game._id, {
      handCards: [1, 2, 3, 4, 5],
      chosenCards: [1, 2, 3, 4, 5],
    });
    await insertCards(last._id, game._id, { handCards: [], chosenCards: [-1, -1, -1, -1, -1] });

    await CardLogic.submitCardsAsync(first); // arms the 30s timer

    // The game disappears before the timer fires. Not hypothetical: the lobby's delete
    // button (client/views/game/game_page.js) and the unstarted-game cron both remove
    // games outright, and the pending setTimeout has no idea.
    await Games.removeAsync(game._id);

    // The callback is fire-and-forget, so the only thing standing between this and an
    // unhandled rejection is the .catch().
    await expect(
      vi.advanceTimersByTimeAsync(GameLogic.TIMER * 1000 + 2500 + 10)
    ).resolves.not.toThrow();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0]).toBe(`autoSubmitIfTimedOut failed for game ${game._id}`);
    expect(errors.mock.calls[0][1]).toBeInstanceOf(TypeError);

    // Nothing is announced here: the game is gone, so there is no chat to announce into.
    expect(await Chat.find().countAsync()).toBe(0);
    vi.useRealTimers();
  });

  it('tells the players when the auto-submit fails on a game that still exists', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const game = await insertGame();
    const first = await insertPlayer(game._id, { name: 'first' });
    const last = await insertPlayer(game._id, { name: 'last' });
    await insertCards(first._id, game._id, {
      handCards: [1, 2, 3, 4, 5],
      chosenCards: [1, 2, 3, 4, 5],
    });
    await insertCards(last._id, game._id, { handCards: [], chosenCards: [-1, -1, -1, -1, -1] });

    await CardLogic.submitCardsAsync(first); // arms the timer

    // Break the force-submit the timer will attempt. Spying only now means the call
    // above still ran for real and armed the timer.
    vi.spyOn(CardLogic, 'submitCardsAsync').mockRejectedValue(new Error('boom'));

    await vi.advanceTimersByTimeAsync(GameLogic.TIMER * 1000 + 2500 + 10);

    expect(errors.mock.calls[0][0]).toBe(`autoSubmitIfTimedOut failed for game ${game._id}`);
    // Without this line the turn just stops and nobody knows why. The wording points at
    // the manual submit, which still works and re-drives the turn.
    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages).toContain(
      'The programming timer failed — please submit your cards to continue.'
    );
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

// Hand a caller a stale game instance: the real read happens, then another driver's
// claim lands before the caller gets to write. This is the race every claim closes.
function claimBehindTheNextRead() {
  const read = Games.findOneAsync.bind(Games);
  vi.spyOn(Games, 'findOneAsync').mockImplementationOnce(async (...args) => {
    const game = await read(...args);
    await Games.updateAsync(game._id, { $inc: { step: 1 } });
    return game;
  });
}

describe('submitCardsAsync: the turn is claimed, not just written', () => {
  afterEach(() => vi.useRealTimers());

  // The A/B race: the client's timer-0 playCards and the server's own auto-submit both
  // land for the same straggler after the 2.5 s grace. Both count everyone ready.
  it('two concurrent submits for the same last player start the turn once', async () => {
    vi.useFakeTimers();
    const game = await insertGame({ timer: 0 });
    const first = await insertPlayer(game._id, { submitted: true });
    const last = await insertPlayer(game._id);
    await insertCards(first._id, game._id, { handCards: [], chosenCards: [1, 2, 3, 4, 5] });
    await insertCards(last._id, game._id, {
      handCards: [6, 7, 8, 9, 10],
      chosenCards: [6, 7, 8, 9, 10],
    });
    // Let PROGRAM -> announce -> PLAY run for real and stop at the first play phase: the
    // PLAY write is the one that must land exactly once.
    vi.spyOn(GameState, 'nextPlayPhaseAsync').mockResolvedValue();
    const updates = vi.spyOn(Games, 'updateAsync');

    const both = Promise.all([CardLogic.submitCardsAsync(last), CardLogic.submitCardsAsync(last)]);
    await vi.runAllTimersAsync();
    await both;

    const playWrites = updates.mock.calls.filter(
      ([, modifier]) => modifier.$set?.gamePhase === GameState.PHASE.PLAY
    );
    expect(playWrites).toHaveLength(1);
    expect(GameState.nextPlayPhaseAsync).toHaveBeenCalledTimes(1);
    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.gamePhase).toBe(GameState.PHASE.PLAY);
    expect(gameDoc.timer).toBe(-1);
  });

  it('a lost timer claim arms no timer', async () => {
    vi.useFakeTimers();
    const game = await insertGame();
    const first = await insertPlayer(game._id);
    await insertPlayer(game._id); // still programming, so `first` would arm the timer
    await insertCards(first._id, game._id, { handCards: [], chosenCards: [1, 2, 3, 4, 5] });
    claimBehindTheNextRead();

    await CardLogic.submitCardsAsync(first);

    expect(vi.getTimerCount()).toBe(0);
    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.timer).toBe(-1); // untouched fixture value
    expect(gameDoc.timerStartedAt).toBeNull();
    // The submission itself stands: the claim only guards the turn, not the player.
    expect((await Players.findOneAsync(first._id)).submitted).toBe(true);
  });

  it('a lost end-of-programming claim leaves the turn to whoever won it', async () => {
    const game = await insertGame({ timer: 1, timerStartedAt: new Date() });
    const player = await insertPlayer(game._id);
    await insertCards(player._id, game._id, { handCards: [], chosenCards: [1, 2, 3, 4, 5] });
    const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();
    claimBehindTheNextRead();

    await CardLogic.submitCardsAsync(player);

    expect(nextPhase).not.toHaveBeenCalled();
    expect((await Games.findOneAsync(game._id)).timer).toBe(1);
  });
});

describe('autoSubmitIfTimedOut: the timer-0 write is pinned to its timer instance', () => {
  afterEach(() => vi.useRealTimers());

  it('flips the timer to 0 when handed the same instant as a different Date object', async () => {
    vi.useFakeTimers();
    const startedAt = new Date(Date.now() - 40_000);
    const game = await insertGame({ timer: 1, timerStartedAt: startedAt });
    // Everyone is in, so nothing is force-submitted and the 0 stays observable.
    const player = await insertPlayer(game._id, { submitted: true });
    await insertCards(player._id, game._id, { handCards: [], chosenCards: [1, 2, 3, 4, 5] });

    // The cron sweep passes the Date it read back from the document, never the object
    // that was stored — the two must still count as the same timer.
    const running = autoSubmitIfTimedOut(game._id, new Date(startedAt.getTime()));
    await vi.advanceTimersByTimeAsync(2500);
    await running;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.timer).toBe(0);
    expect(gameDoc.timerStartedAt).toBeNull();
  });

  it('writes nothing when a new timer instance was armed after its own check', async () => {
    vi.useFakeTimers();
    const startedAt = new Date(Date.now() - 40_000);
    const game = await insertGame({ timer: 1, timerStartedAt: startedAt });
    const player = await insertPlayer(game._id, { submitted: true });
    await insertCards(player._id, game._id, { handCards: [], chosenCards: [1, 2, 3, 4, 5] });
    // Between the read that passes the JS guard and the write: a later turn re-arms.
    const rearmedAt = new Date();
    const read = Games.findOneAsync.bind(Games);
    vi.spyOn(Games, 'findOneAsync').mockImplementationOnce(async (...args) => {
      const stale = await read(...args);
      await Games.updateAsync(game._id, { $set: { timerStartedAt: rearmedAt } });
      return stale;
    });

    const running = autoSubmitIfTimedOut(game._id, startedAt);
    await vi.advanceTimersByTimeAsync(2500);
    await running;

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.timer).toBe(1);
    expect(gameDoc.timerStartedAt).toEqual(rearmedAt);
  });
});
