// Drives the real both/methods/ handlers through Meteor.callAsync against the
// in-memory collections — no reimplementation, no mocks except where a handler would
// otherwise run the whole phase machine (GameState) or the card submission pipeline
// (CardLogic), both of which have their own tests under test/both/.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import { loginAs, logout, registeredMethods, resetFakeCollections } from '../setup.js';
import { methodsConfig, simulatedMethods } from '../stubs/jam-method.js';
import { insertCards, insertGame, insertPlayer } from '../helpers/fixtures.js';
import { BoardBox } from '../../both/board_box.ts';
import { CardLogic } from '../../both/cardlogic.ts';
import { GameLogic } from '../../both/gamelogic.ts';
import { GameState } from '../../both/gamestate.ts';
import { Cards } from '../../collections/cards.ts';
import { Chat } from '../../collections/chat.ts';
import { Decks } from '../../collections/deck.ts';
import { Games } from '../../collections/games.ts';
import { Highscores } from '../../collections/highscores.ts';
import { Players } from '../../collections/players.ts';

const call = (name, ...args) => Meteor.callAsync(name, ...args);

const messages = async (gameId) =>
  (await Chat.find(gameId ? { gameId } : undefined).fetchAsync()).map((c) => c.message);

beforeEach(() => resetFakeCollections());
afterEach(() => vi.restoreAllMocks());

describe('method registration', () => {
  it('registers every method the client calls', () => {
    // Every module under both/methods/ is loaded for its side effects by the entry
    // point; if one of those imports is ever dropped, that whole surface silently stops
    // working — card selection, or chat, or the lobby.
    expect(registeredMethods()).toEqual([
      'addMessage',
      'createGame',
      'deselectAllCards',
      'deselectCard',
      'isEmailAvailable',
      'joinGame',
      'leaveGame',
      'playCards',
      'resendVerificationEmail',
      'selectBoard',
      'selectCard',
      'selectRespawnDirection',
      'selectRespawnPosition',
      'startGame',
      'togglePowerDown',
    ]);
  });

  it('configures jam:method before any method module defines a method', () => {
    // Both are read by `createMethod` in a method module's body, so a module that loaded
    // ahead of both/methods/config.ts would silently keep the package defaults — see the
    // header there. The 401 is what the deleted `if (!user) throw ...` preambles threw.
    expect(methodsConfig()).toMatchObject({ serverOnly: true });
    expect(methodsConfig().loggedOutError).toMatchObject({
      error: 401,
      reason: 'You need to login',
    });
  });

  // The exceptions to that global default, and the tripwire for it. These three are the
  // only methods with `serverOnly: false`, so the only ones the browser registers a stub
  // for — which is what fills a register slot before the round trip. A fourth name here
  // means some other method started writing to minimongo and reconciling; a missing one
  // means card selection quietly stopped being instant. Neither shows up as an error.
  it('simulates the three card-selection methods and nothing else', () => {
    expect(simulatedMethods()).toEqual(['deselectAllCards', 'deselectCard', 'selectCard']);
  });
});

describe('createGame', () => {
  it('refuses an anonymous caller', async () => {
    logout();
    await expect(call('createGame', { name: 'a game' })).rejects.toMatchObject({ error: 401 });
    expect(await Games.find().countAsync()).toBe(0);
  });

  it('refuses an empty name', async () => {
    await loginAs();
    await expect(call('createGame', { name: '' })).rejects.toMatchObject({ error: 400 });
    await expect(call('createGame', {})).rejects.toMatchObject({ error: 400 });
  });

  it('creates an idle game owned by the caller and seats them', async () => {
    const user = await loginAs({ emails: [{ address: 'ben@example.com', verified: true }] });

    const gameId = await call('createGame', { name: 'a game' });

    const game = await Games.findOneAsync(gameId);
    expect(game).toMatchObject({
      name: 'a game',
      userId: user._id,
      author: 'ben', // getUsername() falls back to the local part of the address
      started: false,
      gamePhase: GameState.PHASE.IDLE,
      playPhase: GameState.PLAY_PHASE.IDLE,
      respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
      programRound: 0,
      boardId: 0,
      waitingForRespawn: [],
      cardsToPlay: [],
      announce: false,
      step: 0,
      lastStepAt: null,
      // Seeded null rather than left absent, so the schema can require them.
      timerStartedAt: null,
      respawnPlayerId: null,
      respawnUserId: null,
      selectOptions: null,
      announceCard: null,
    });
    // createGame delegates the seating to joinGame rather than duplicating it.
    expect(await Players.find({ gameId }).countAsync()).toBe(1);
    expect(await messages(gameId)).toEqual(['Game created', 'ben joined the game']);
  });

  it("uses the game's name as a board name when it matches the catalog", async () => {
    await loginAs();

    const gameId = await call('createGame', { name: 'risky_exchange' });

    const game = await Games.findOneAsync(gameId);
    expect(game.boardId).toBe(BoardBox.getBoardId('risky_exchange'));
    expect(game.min_player).toBe(BoardBox.getBoard(game.boardId).min_player);
    expect(game.max_player).toBe(BoardBox.getBoard(game.boardId).max_player);
  });

  it('falls back to the default board when the name matches nothing', async () => {
    await loginAs();

    const gameId = await call('createGame', { name: 'not a board' });

    const game = await Games.findOneAsync(gameId);
    expect(game.boardId).toBe(0);
    expect(game.max_player).toBe(BoardBox.getBoard(0).max_player);
  });
});

describe('joinGame', () => {
  it('refuses an anonymous caller', async () => {
    logout();
    await expect(call('joinGame', { gameId: 'nope' })).rejects.toMatchObject({ error: 401 });
  });

  it('refuses an unknown game id', async () => {
    await loginAs();
    await expect(call('joinGame', { gameId: 'nope' })).rejects.toMatchObject({ error: 404 });
  });

  it('creates a player with three lives, off-board, and a matching Cards doc', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, started: false });

    await call('joinGame', { gameId: gameId });

    const player = await Players.findOneAsync({ gameId, userId: user._id });
    expect(player).toMatchObject({
      lives: 3,
      damage: 0,
      visited_checkpoints: 0,
      needsRespawn: false,
      powerState: GameLogic.ON,
      optionalInstantPowerDown: false,
      position: { x: -1, y: -1 },
      chosenCardsCnt: 0,
      optionCards: {},
      // Seeded null rather than left absent, so the schema can require it.
      ablativeCoat: null,
    });
    expect(player.cards).toEqual(Array(GameLogic.CARD_SLOTS).fill(CardLogic.EMPTY));

    const cards = await Cards.findOneAsync({ gameId, playerId: player._id });
    expect(cards.handCards).toEqual([]);
    expect(cards.chosenCards).toEqual(Array(GameLogic.CARD_SLOTS).fill(CardLogic.EMPTY));
  });

  it('seats a player with a single life on the dev-test board', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: BoardBox.dev_test_board_id,
      started: false,
    });

    await call('joinGame', { gameId: gameId });

    const player = await Players.findOneAsync({ gameId, userId: user._id });
    expect(player.lives).toBe(1);
  });

  it('is idempotent — joining twice does not seat a second robot', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, started: false });

    await call('joinGame', { gameId: gameId });
    await call('joinGame', { gameId: gameId });

    expect(await Players.find({ gameId, userId: user._id }).countAsync()).toBe(1);
    expect(await Cards.find({ gameId, userId: user._id }).countAsync()).toBe(1);
    // ...but it still announces the join a second time.
    expect(await messages(gameId)).toHaveLength(2);
  });
});

describe('leaveGame', () => {
  it('refuses an anonymous caller and an unknown game', async () => {
    logout();
    await expect(call('leaveGame', { gameId: 'nope' })).rejects.toMatchObject({ error: 401 });
    await loginAs();
    await expect(call('leaveGame', { gameId: 'nope' })).rejects.toMatchObject({ error: 404 });
  });

  it('refuses to let a seated player quit outside the program phase', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PLAY,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });

    await expect(call('leaveGame', { gameId: gameId })).rejects.toMatchObject({ error: 403 });
    expect(await Players.find({ gameId }).countAsync()).toBe(1);
  });

  it('lets a spectator leave a running game (they hold no robot)', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PLAY,
    });

    await expect(call('leaveGame', { gameId: gameId })).resolves.not.toThrow();
  });

  it('returns held hand and chosen cards to the deck before removing the player', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });
    await Players.insertAsync({ gameId, userId: 'other', name: 'other' });
    await Cards.insertAsync({
      gameId,
      userId: user._id,
      handCards: [11, 12],
      // EMPTY (-1) slots must not be returned as if they were cards.
      chosenCards: [20, CardLogic.EMPTY, 21, CardLogic.EMPTY, CardLogic.EMPTY],
    });
    await Decks.insertAsync({ gameId, cards: [1], optionCards: [], discardedOptionCards: [] });

    await call('leaveGame', { gameId: gameId });

    const deck = await Decks.findOneAsync({ gameId });
    expect([...deck.cards].sort((a, b) => a - b)).toEqual([1, 11, 12, 20, 21]);
    expect(await Cards.find({ gameId, userId: user._id }).countAsync()).toBe(0);
    expect(await Players.find({ gameId, userId: user._id }).countAsync()).toBe(0);
  });

  it("sends a leaver's option cards to the discard pile, announced in chat", async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
    });
    await Players.insertAsync({
      gameId,
      userId: user._id,
      name: 'ben',
      optionCards: { extra_memory: true },
    });
    await Players.insertAsync({ gameId, userId: 'other', name: 'other' });
    await Decks.insertAsync({ gameId, cards: [], optionCards: [], discardedOptionCards: [] });

    await call('leaveGame', { gameId: gameId });

    const deck = await Decks.findOneAsync({ gameId });
    expect(deck.discardedOptionCards).toEqual([CardLogic.getOptionId('extra_memory')]);
    expect(await messages(gameId)).toContain('ben discarded option card Extra Memory');
    expect(await Players.find({ gameId, userId: user._id }).countAsync()).toBe(0);
  });

  it('ends the game and rebuilds the highscores when one player is left', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });
    await Players.insertAsync({ gameId, userId: 'other', name: 'survivor' });

    await call('leaveGame', { gameId: gameId });

    const game = await Games.findOneAsync(gameId);
    expect(game.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(game.winner).toBe('survivor');
    expect(game.stopped).toBeTypeOf('number');
    // buildHighscores() ran for real against the aggregate — 'survivor' now tops mostWon.
    expect(await Highscores.findOneAsync({ type: 'mostWon', rank: 1 })).toMatchObject({
      name: 'survivor',
      value: 1,
    });
  });

  it("ends the game with winner 'Nobody' when the last player leaves", async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });

    await call('leaveGame', { gameId: gameId });

    const game = await Games.findOneAsync(gameId);
    expect(game.gamePhase).toBe(GameState.PHASE.ENDED);
    expect(game.winner).toBe('Nobody');
    // Unlike the last-player-standing branch, this one deliberately skips the rebuild:
    // a game nobody won contributes nothing to mostWon.
    expect(await Highscores.find().countAsync()).toBe(0);
  });

  it('leaves an unstarted game without touching the deck or ending it', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, started: false });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });

    await call('leaveGame', { gameId: gameId });

    const game = await Games.findOneAsync(gameId);
    expect(game.gamePhase).toBeUndefined();
    expect(game.winner).toBeUndefined();
    expect(await Players.find({ gameId }).countAsync()).toBe(0);
  });
});

describe('selectBoard', () => {
  it('refuses a board name that is not in the catalog', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });

    await expect(
      call('selectBoard', { boardName: 'no such board', gameId: gameId })
    ).rejects.toMatchObject({
      error: 404,
    });
    expect((await Games.findOneAsync(gameId)).boardId).toBe(0);
  });

  it('refuses an unknown game id', async () => {
    await loginAs();
    await expect(
      call('selectBoard', { boardName: 'checkmate', gameId: 'nope' })
    ).rejects.toMatchObject({ error: 404 });
  });

  it('switches the board and copies its player limits onto the game', async () => {
    await loginAs({ profile: { name: 'Ben' } });
    const gameId = await Games.insertAsync({ boardId: 0 });

    await call('selectBoard', { boardName: 'checkmate', gameId: gameId });

    const boardId = BoardBox.getBoardId('checkmate');
    const game = await Games.findOneAsync(gameId);
    expect(game).toMatchObject({
      boardId,
      min_player: BoardBox.getBoard(boardId).min_player,
      max_player: BoardBox.getBoard(boardId).max_player,
    });
    expect(await messages(gameId)).toEqual(['Ben selected board checkmate']);
  });

  // Regression guard. selectBoard used to skip the login check every other method makes,
  // so an anonymous call got as far as writing the new board before getUsername(undefined)
  // threw a bare TypeError — a write, then the wrong error, from an unauthenticated caller.
  it('refuses an anonymous caller without touching the game', async () => {
    logout();
    const gameId = await Games.insertAsync({ boardId: 0 });

    await expect(
      call('selectBoard', { boardName: 'checkmate', gameId: gameId })
    ).rejects.toMatchObject({ error: 401 });
    expect((await Games.findOneAsync(gameId)).boardId).toBe(0);
  });
});

describe('startGame', () => {
  it('refuses to start with more players than the board seats', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, max_player: 1 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'a', position: { x: -1, y: -1 } });
    await Players.insertAsync({ gameId, userId: 'b', name: 'b', position: { x: -1, y: -1 } });

    await expect(call('startGame', { gameId: gameId })).rejects.toMatchObject({ error: 403 });
  });

  it('refuses an anonymous caller and an unknown game', async () => {
    const gameId = await Games.insertAsync({ boardId: 0, max_player: 8 });

    logout();
    await expect(call('startGame', { gameId: gameId })).rejects.toMatchObject({ error: 401 });

    await loginAs();
    await expect(call('startGame', { gameId: 'nope' })).rejects.toMatchObject({ error: 404 });
  });

  it('places every robot on a start point and advances the phase', async () => {
    const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();
    await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      max_player: 8,
      gamePhase: GameState.PHASE.IDLE,
    });
    await Players.insertAsync({ gameId, userId: 'a', name: 'a', position: { x: -1, y: -1 } });
    await Players.insertAsync({ gameId, userId: 'b', name: 'b', position: { x: -1, y: -1 } });

    await call('startGame', { gameId: gameId });

    const board = BoardBox.getBoard(0);
    const players = await Players.find({ gameId }).fetchAsync();
    players.forEach((player, i) => {
      const start = board.startpoints[i];
      expect(player.position).toEqual({ x: start.x, y: start.y });
      expect(player.direction).toBe(start.direction);
      expect(player.start).toEqual(start);
      // `for...in` over the array is deliberate (see the note in methods.js): robotId is
      // persisted as the *string* index, and existing documents rely on that.
      expect(player.robotId).toBe(String(i));
    });
    expect(await messages(gameId)).toEqual(['Game started']);
    expect(nextPhase).toHaveBeenCalledWith(gameId);
  });

  // A double-clicked start. Both calls place the robots (the same positions, twice) and
  // both drive the phase machine; only one of them can claim IDLE -> DEAL, so the hands
  // are dealt once.
  it('two concurrent starts deal one hand each', async () => {
    vi.useFakeTimers();
    try {
      await loginAs();
      const game = await insertGame({
        gamePhase: GameState.PHASE.IDLE,
        started: false,
        max_player: 8,
      });
      const a = await insertPlayer(game._id, { userId: 'a', name: 'a' });
      const b = await insertPlayer(game._id, { userId: 'b', name: 'b' });
      await insertCards(a._id, game._id, { userId: 'a' });
      await insertCards(b._id, game._id, { userId: 'b' });
      const updates = vi.spyOn(Games, 'updateAsync');

      const both = Promise.all([
        call('startGame', { gameId: game._id }),
        call('startGame', { gameId: game._id }),
      ]);
      await vi.runAllTimersAsync();
      await both;

      // IDLE -> DEAL is the very first claim, so both drivers attempt it; the selector
      // lets exactly one of them modify the document.
      const dealAttempts = updates.mock.calls
        .map((args, i) => [args, updates.mock.results[i].value])
        .filter(([[, modifier]]) => modifier.$set?.gamePhase === GameState.PHASE.DEAL);
      expect(dealAttempts).toHaveLength(2);
      const modified = await Promise.all(dealAttempts.map(([, result]) => result));
      expect(modified.filter((n) => n === 1)).toHaveLength(1);
      const gameDoc = await Games.findOneAsync(game._id);
      expect(gameDoc.gamePhase).toBe(GameState.PHASE.PROGRAM);
      expect(gameDoc.programRound).toBe(2); // fixture seeds 1; one deal
      for (const player of [a, b]) {
        expect((await Cards.findOneAsync({ playerId: player._id })).handCards).toHaveLength(9);
      }
      // The 8-player deck is 84 cards; two hands of nine came off it, once.
      expect((await Decks.findOneAsync({ gameId: game._id })).cards).toHaveLength(84 - 18);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('playCards', () => {
  it('refuses a caller who holds no robot in that game', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });

    await expect(call('playCards', { gameId, programRound: 0 })).rejects.toMatchObject({
      error: 404,
    });
  });

  it('submits the caller’s full program and announces it', async () => {
    const submit = vi.spyOn(CardLogic, 'submitCardsAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, programRound: 2, timer: -1 });
    const playerId = await Players.insertAsync({
      gameId,
      userId: user._id,
      name: 'ben',
      submitted: false,
      chosenCardsCnt: GameLogic.CARD_SLOTS,
    });

    await call('playCards', { gameId, programRound: 2 });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]._id).toBe(playerId);
    expect(await messages(gameId)).toEqual(['ben submitted cards']);
  });

  it('ignores a second submission from an already-submitted player', async () => {
    const submit = vi.spyOn(CardLogic, 'submitCardsAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, programRound: 1 });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben', submitted: true });

    await call('playCards', { gameId, programRound: 1 });

    expect(submit).not.toHaveBeenCalled();
    expect(await messages(gameId)).toEqual([]);
  });

  // Regression: the final submitter's playCards spans the entire turn (the submit
  // awaits the phase machine), so a duplicate queued behind it on the same connection
  // — or a Meteor retry after a reconnect — used to execute against the NEXT program
  // phase, pass the freshly-reset `!submitted` check, and submit five random cards on
  // the player's behalf at the start of the turn.
  it('rejects a submission carrying a previous turn’s round number', async () => {
    const submit = vi.spyOn(CardLogic, 'submitCardsAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, programRound: 2, timer: -1 });
    await Players.insertAsync({
      gameId,
      userId: user._id,
      name: 'ben',
      submitted: false,
      chosenCardsCnt: GameLogic.CARD_SLOTS,
    });

    await expect(call('playCards', { gameId, programRound: 1 })).rejects.toMatchObject({
      error: 409,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(await messages(gameId)).toEqual([]);
  });

  it('refuses an incomplete program while the timer has not expired', async () => {
    const submit = vi.spyOn(CardLogic, 'submitCardsAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, programRound: 1, timer: -1 });
    await Players.insertAsync({
      gameId,
      userId: user._id,
      name: 'ben',
      submitted: false,
      chosenCardsCnt: 3,
    });

    await expect(call('playCards', { gameId, programRound: 1 })).rejects.toMatchObject({
      error: 403,
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('random-fills an incomplete program while the expired-timer window is open', async () => {
    const submit = vi.spyOn(CardLogic, 'submitCardsAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, programRound: 1, timer: 0 });
    await Players.insertAsync({
      gameId,
      userId: user._id,
      name: 'ben',
      submitted: false,
      chosenCardsCnt: 0,
    });

    await call('playCards', { gameId, programRound: 1 });

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('lets a powered-down player submit an empty program regardless of the timer', async () => {
    const submit = vi.spyOn(CardLogic, 'submitCardsAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, programRound: 1, timer: -1 });
    await Players.insertAsync({
      gameId,
      userId: user._id,
      name: 'ben',
      submitted: false,
      powerState: GameLogic.OFF,
      chosenCardsCnt: 0,
    });

    await call('playCards', { gameId, programRound: 1 });

    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe('respawn selection', () => {
  it('moves on to the direction step', async () => {
    const respawn = vi.spyOn(GameLogic, 'respawnPlayerAtPosAsync').mockResolvedValue();
    vi.spyOn(GameState, 'nextRespawnPhaseAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
      step: 0,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });

    // The client converts the DOM data attributes; the method's schema says Number.
    await call('selectRespawnPosition', { gameId: gameId, x: 3, y: 4 });

    expect(respawn).toHaveBeenCalledTimes(1);
    expect(respawn.mock.calls[0].slice(1)).toEqual([3, 4]);
    // The phase change is a claim, so it moves `step` along.
    expect(await Games.findOneAsync(gameId)).toMatchObject({
      respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_DIRECTION,
      step: 1,
    });
    expect(await messages(gameId)).toEqual(['ben chose position']);
  });

  it('returns to the game phase machine', async () => {
    const respawn = vi.spyOn(GameLogic, 'respawnPlayerWithDirAsync').mockResolvedValue();
    const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });

    await call('selectRespawnDirection', { gameId: gameId, direction: GameLogic.LEFT });

    expect(respawn.mock.calls[0][1]).toBe(GameLogic.LEFT);
    expect(nextPhase).toHaveBeenCalledWith(gameId);
  });

  // Both methods used to dereference whatever the lookups returned: an anonymous caller
  // got a bare TypeError out of the direction step, and the position step wrote nothing
  // and said nothing at all.
  it('refuses an anonymous caller', async () => {
    logout();
    const gameId = await Games.insertAsync({ boardId: 0 });

    await expect(
      call('selectRespawnPosition', { gameId: gameId, x: 3, y: 4 })
    ).rejects.toMatchObject({
      error: 401,
    });
    await expect(
      call('selectRespawnDirection', { gameId: gameId, direction: GameLogic.LEFT })
    ).rejects.toMatchObject({
      error: 401,
    });
  });

  it('refuses a caller who holds no robot in that game', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });

    await expect(
      call('selectRespawnPosition', { gameId: gameId, x: 3, y: 4 })
    ).rejects.toMatchObject({
      error: 404,
    });
    await expect(
      call('selectRespawnDirection', { gameId: gameId, direction: GameLogic.LEFT })
    ).rejects.toMatchObject({
      error: 404,
    });
  });
});

describe('togglePowerDown', () => {
  it.each([
    ['ON', GameLogic.ON, GameLogic.DOWN],
    ['DOWN', GameLogic.DOWN, GameLogic.ON],
    ['OFF', GameLogic.OFF, GameLogic.ON],
  ])('cycles %s to the next state and persists it', async (_label, from, to) => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });
    const playerId = await Players.insertAsync({
      gameId,
      userId: user._id,
      name: 'ben',
      powerState: from,
    });

    await expect(call('togglePowerDown', { gameId })).resolves.toBe(to);
    expect((await Players.findOneAsync(playerId)).powerState).toBe(to);
  });

  it('refuses a caller who holds no robot in that game', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });

    await expect(call('togglePowerDown', { gameId })).rejects.toMatchObject({ error: 404 });
  });
});

describe('addMessage', () => {
  it('refuses an anonymous caller', async () => {
    logout();
    await expect(call('addMessage', { message: 'hi', gameId: 'g' })).rejects.toMatchObject({
      error: 401,
    });
    expect(await Chat.find().countAsync()).toBe(0);
  });

  it('stamps the message with the author and a submission time', async () => {
    const user = await loginAs({ profile: { name: 'Ben' } });

    await call('addMessage', { message: 'hello', gameId: 'g1' });

    const chat = await Chat.findOneAsync({ gameId: 'g1' });
    expect(chat).toMatchObject({ message: 'hello', gameId: 'g1', userId: user._id, author: 'Ben' });
    expect(chat.submitted).toBeTypeOf('number');
  });
});

describe('resendVerificationEmail', () => {
  it('refuses an address with no account', async () => {
    await expect(
      call('resendVerificationEmail', { email: 'nobody@example.com' })
    ).rejects.toMatchObject({
      error: 'user-not-found',
    });
  });

  it('refuses an already-verified address', async () => {
    await Meteor.users.insertAsync({
      _id: 'u1',
      emails: [{ address: 'done@example.com', verified: true }],
    });

    await expect(
      call('resendVerificationEmail', { email: 'done@example.com' })
    ).rejects.toMatchObject({
      error: 'already-verified',
    });
  });

  it('sends to an unverified address', async () => {
    await Meteor.users.insertAsync({
      _id: 'u2',
      emails: [{ address: 'pending@example.com', verified: false }],
    });
    const send = vi.spyOn(Accounts, 'sendVerificationEmail').mockImplementation(() => {});

    await call('resendVerificationEmail', { email: 'pending@example.com' });

    expect(send).toHaveBeenCalledWith('u2');
  });
});

describe('isEmailAvailable', () => {
  it('is true in development even without EMAIL_URL, false in production without it', async () => {
    const previous = process.env.EMAIL_URL;
    delete process.env.EMAIL_URL;
    try {
      await expect(call('isEmailAvailable')).resolves.toBe(true);

      Meteor.isDevelopment = false;
      await expect(call('isEmailAvailable')).resolves.toBe(false);

      process.env.EMAIL_URL = 'smtp://localhost';
      await expect(call('isEmailAvailable')).resolves.toBe(true);
    } finally {
      Meteor.isDevelopment = true;
      if (previous === undefined) delete process.env.EMAIL_URL;
      else process.env.EMAIL_URL = previous;
    }
  });
});
