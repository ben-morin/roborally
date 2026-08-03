// Drives the real server/methods.js handlers through Meteor.callAsync against the
// in-memory collections — no reimplementation, no mocks except where a handler would
// otherwise run the whole phase machine (GameState) or the card submission pipeline
// (CardLogic), both of which have their own tests under test/both/.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import { loginAs, logout, registeredMethods, resetFakeCollections } from '../setup.js';
import { BoardBox } from '../../both/board_box.js';
import { CardLogic } from '../../both/cardlogic.js';
import { GameLogic } from '../../both/gamelogic.js';
import { GameState } from '../../both/gamestate.js';
import { Cards } from '../../collections/cards.js';
import { Chat } from '../../collections/chat.js';
import { Deck } from '../../collections/deck.js';
import { Games } from '../../collections/games.js';
import { Highscores } from '../../collections/highscores.js';
import { Players } from '../../collections/players.js';

const call = (name, ...args) => Meteor.callAsync(name, ...args);

const messages = async (gameId) =>
  (await Chat.find(gameId ? { gameId } : undefined).fetchAsync()).map((c) => c.message);

beforeEach(() => resetFakeCollections());
afterEach(() => vi.restoreAllMocks());

describe('method registration', () => {
  it('registers every method the client calls', () => {
    // cardMethods.js is loaded for its side effects by the entry point; if that import
    // is ever dropped, card selection silently stops working. Same for the rest.
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
});

describe('createGame', () => {
  it('refuses an anonymous caller', async () => {
    logout();
    await expect(call('createGame', { name: 'a game' })).rejects.toMatchObject({ error: 401 });
    expect(await Games.find().countAsync()).toBe(0);
  });

  it('refuses an empty name', async () => {
    await loginAs();
    await expect(call('createGame', { name: '' })).rejects.toMatchObject({ error: 303 });
    await expect(call('createGame', {})).rejects.toMatchObject({ error: 303 });
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
      boardId: 0,
      waitingForRespawn: [],
      cardsToPlay: [],
      announce: false,
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
    await expect(call('joinGame', 'nope')).rejects.toMatchObject({ error: 401 });
  });

  it('refuses an unknown game id', async () => {
    await loginAs();
    await expect(call('joinGame', 'nope')).rejects.toMatchObject({ error: 401 });
  });

  it('creates a player with three lives, off-board, and a matching Cards doc', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, started: false });

    await call('joinGame', gameId);

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

    await call('joinGame', gameId);

    const player = await Players.findOneAsync({ gameId, userId: user._id });
    expect(player.lives).toBe(1);
  });

  it('is idempotent — joining twice does not seat a second robot', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, started: false });

    await call('joinGame', gameId);
    await call('joinGame', gameId);

    expect(await Players.find({ gameId, userId: user._id }).countAsync()).toBe(1);
    expect(await Cards.find({ gameId, userId: user._id }).countAsync()).toBe(1);
    // ...but it still announces the join a second time.
    expect(await messages(gameId)).toHaveLength(2);
  });
});

describe('leaveGame', () => {
  it('refuses an anonymous caller and an unknown game', async () => {
    logout();
    await expect(call('leaveGame', 'nope')).rejects.toMatchObject({ error: 401 });
    await loginAs();
    await expect(call('leaveGame', 'nope')).rejects.toMatchObject({ error: 401 });
  });

  it('refuses to let a seated player quit outside the program phase', async () => {
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PLAY,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });

    await expect(call('leaveGame', gameId)).rejects.toMatchObject({ error: 403 });
    expect(await Players.find({ gameId }).countAsync()).toBe(1);
  });

  it('lets a spectator leave a running game (they hold no robot)', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      started: true,
      gamePhase: GameState.PHASE.PLAY,
    });

    await expect(call('leaveGame', gameId)).resolves.not.toThrow();
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
    await Deck.insertAsync({ gameId, cards: [1], optionCards: [], discardedOptionCards: [] });

    await call('leaveGame', gameId);

    const deck = await Deck.findOneAsync({ gameId });
    expect([...deck.cards].sort((a, b) => a - b)).toEqual([1, 11, 12, 20, 21]);
    expect(await Cards.find({ gameId, userId: user._id }).countAsync()).toBe(0);
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

    await call('leaveGame', gameId);

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

    await call('leaveGame', gameId);

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

    await call('leaveGame', gameId);

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

    await expect(call('selectBoard', 'no such board', gameId)).rejects.toMatchObject({
      error: 401,
    });
    expect((await Games.findOneAsync(gameId)).boardId).toBe(0);
  });

  it('refuses an unknown game id', async () => {
    await loginAs();
    await expect(call('selectBoard', 'checkmate', 'nope')).rejects.toMatchObject({ error: 401 });
  });

  it('switches the board and copies its player limits onto the game', async () => {
    await loginAs({ profile: { name: 'Ben' } });
    const gameId = await Games.insertAsync({ boardId: 0 });

    await call('selectBoard', 'checkmate', gameId);

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

    await expect(call('selectBoard', 'checkmate', gameId)).rejects.toMatchObject({ error: 401 });
    expect((await Games.findOneAsync(gameId)).boardId).toBe(0);
  });
});

describe('startGame', () => {
  it('refuses to start with more players than the board seats', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0, max_player: 1 });
    await Players.insertAsync({ gameId, userId: 'a', name: 'a', position: { x: -1, y: -1 } });
    await Players.insertAsync({ gameId, userId: 'b', name: 'b', position: { x: -1, y: -1 } });

    await expect(call('startGame', gameId)).rejects.toMatchObject({ error: 401 });
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

    await call('startGame', gameId);

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
});

describe('playCards', () => {
  it('refuses a caller who holds no robot in that game', async () => {
    await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });

    await expect(call('playCards', gameId)).rejects.toMatchObject({ error: 401 });
  });

  it('submits the caller’s cards and announces it', async () => {
    const submit = vi.spyOn(CardLogic, 'submitCardsAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });
    const playerId = await Players.insertAsync({
      gameId,
      userId: user._id,
      name: 'ben',
      submitted: false,
    });

    await call('playCards', gameId);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]._id).toBe(playerId);
    expect(await messages(gameId)).toEqual(['ben submitted cards']);
  });

  it('ignores a second submission from an already-submitted player', async () => {
    const submit = vi.spyOn(CardLogic, 'submitCardsAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben', submitted: true });

    await call('playCards', gameId);

    expect(submit).not.toHaveBeenCalled();
    expect(await messages(gameId)).toEqual([]);
  });
});

describe('respawn selection', () => {
  it('coerces the position to numbers and moves on to the direction step', async () => {
    const respawn = vi.spyOn(GameLogic, 'respawnPlayerAtPosAsync').mockResolvedValue();
    vi.spyOn(GameState, 'nextRespawnPhaseAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({
      boardId: 0,
      respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
    });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });

    // The client passes these straight through from DOM data attributes, i.e. as strings.
    await call('selectRespawnPosition', gameId, '3', '4');

    expect(respawn).toHaveBeenCalledTimes(1);
    expect(respawn.mock.calls[0].slice(1)).toEqual([3, 4]);
    expect((await Games.findOneAsync(gameId)).respawnPhase).toBe(
      GameState.RESPAWN_PHASE.CHOOSE_DIRECTION
    );
    expect(await messages(gameId)).toEqual(['ben chose position']);
  });

  it('coerces the direction to a number and returns to the game phase machine', async () => {
    const respawn = vi.spyOn(GameLogic, 'respawnPlayerWithDirAsync').mockResolvedValue();
    const nextPhase = vi.spyOn(GameState, 'nextGamePhaseAsync').mockResolvedValue();
    const user = await loginAs();
    const gameId = await Games.insertAsync({ boardId: 0 });
    await Players.insertAsync({ gameId, userId: user._id, name: 'ben' });

    await call('selectRespawnDirection', gameId, String(GameLogic.LEFT));

    expect(respawn.mock.calls[0][1]).toBe(GameLogic.LEFT);
    expect(nextPhase).toHaveBeenCalledWith(gameId);
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

    await expect(call('togglePowerDown', gameId)).resolves.toBe(to);
    expect((await Players.findOneAsync(playerId)).powerState).toBe(to);
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
    await expect(call('resendVerificationEmail', 'nobody@example.com')).rejects.toMatchObject({
      error: 'user-not-found',
    });
  });

  it('refuses an already-verified address', async () => {
    await Meteor.users.insertAsync({
      _id: 'u1',
      emails: [{ address: 'done@example.com', verified: true }],
    });

    await expect(call('resendVerificationEmail', 'done@example.com')).rejects.toMatchObject({
      error: 'already-verified',
    });
  });

  it('sends to an unverified address', async () => {
    await Meteor.users.insertAsync({
      _id: 'u2',
      emails: [{ address: 'pending@example.com', verified: false }],
    });
    const send = vi.spyOn(Accounts, 'sendVerificationEmail').mockImplementation(() => {});

    await call('resendVerificationEmail', 'pending@example.com');

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
