// The games manager's two actions. Ending goes through the turn chain's claim, so a driver
// still inside the turn cannot write the game back to life; deleting is only for a lobby or
// a game that is over, since removing rows under a running turn breaks it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import { loginAs, logout, resetAccounts, resetFakeCollections, setSettings } from '../setup.js';
import { insertCards, insertDeck, insertGame, insertPlayer } from '../helpers/fixtures.js';
import { GameState } from '../../both/gamestate.ts';
import { Cards } from '../../collections/cards.ts';
import { Chat } from '../../collections/chat.ts';
import { Decks } from '../../collections/deck.ts';
import { Games, MAX_RESUME_ATTEMPTS } from '../../collections/games.ts';
import { Highscores } from '../../collections/highscores.ts';
import { Players } from '../../collections/players.ts';
import { buildHighscores } from '../../server/highscores.ts';

const { ENDED, PLAY, PROGRAM } = GameState.PHASE;
const ADMIN_EMAIL = 'admin@example.com';

const call = (name, ...args) => Meteor.callAsync(name, ...args);
const endGame = (gameId) => call('adminEndGame', { gameId });
const deleteGame = (gameId) => call('adminDeleteGame', { gameId });
const renameGame = (gameId, name = 'Sunday Race') => call('adminRenameGame', { gameId, name });
const messages = async (gameId) => (await Chat.find({ gameId }).fetchAsync()).map((c) => c.message);
const ranking = async (type) =>
  (await Highscores.find({ type }).fetchAsync())
    .sort((a, b) => a.rank - b.rank)
    .map(({ name, value }) => ({ name, value }));

async function asAdmin() {
  setSettings({ ADMIN_EMAILS: [ADMIN_EMAIL] });
  return loginAs({
    _id: 'admin',
    profile: { name: 'admin' },
    emails: [{ address: ADMIN_EMAIL, verified: true }],
  });
}

// A game with its rows in every child collection, so a delete can be seen to take them all.
async function gameWithRows(overrides) {
  const game = await insertGame({ name: 'Race', userId: 'ann', author: 'ann', ...overrides });
  const player = await insertPlayer(game._id, { userId: 'ann', name: 'ann' });
  await insertCards(player._id, game._id, { userId: 'ann' });
  await insertDeck(game._id);
  await game.chatAsync('ann joined the game');
  return game;
}

async function rowsOf(gameId) {
  return {
    game: await Games.findOneAsync(gameId),
    players: await Players.find({ gameId }).countAsync(),
    cards: await Cards.find({ gameId }).countAsync(),
    decks: await Decks.find({ gameId }).countAsync(),
    chat: await Chat.find({ gameId }).countAsync(),
  };
}

// The driver claims between the method's read and its write: the copy it read carries a
// `step` the database has already moved past, so the claim matches nothing.
function driverMovesOnRead(times) {
  const read = Games.findOneAsync.bind(Games);
  let left = times;
  return vi.spyOn(Games, 'findOneAsync').mockImplementation(async (...args) => {
    const game = await read(...args);
    if (game && left-- > 0) await Games.updateAsync(game._id, { $inc: { step: 1 } });
    return game;
  });
}

beforeEach(() => {
  resetFakeCollections();
  resetAccounts();
  setSettings();
  logout();
});
afterEach(() => vi.restoreAllMocks());

describe.each([
  ['adminEndGame', endGame],
  ['adminDeleteGame', deleteGame],
  ['adminRenameGame', renameGame],
])('%s', (name, action) => {
  it('refuses an anonymous caller', async () => {
    setSettings({ ADMIN_EMAILS: [ADMIN_EMAIL] });
    const game = await insertGame({ winner: 'Nobody' });
    await expect(action(game._id)).rejects.toMatchObject({ error: 401 });
  });

  it('refuses a player and changes nothing', async () => {
    setSettings({ ADMIN_EMAILS: [ADMIN_EMAIL] });
    await loginAs({ _id: 'player', emails: [{ address: 'player@example.com', verified: true }] });
    const game = await gameWithRows({ started: false, gamePhase: GameState.PHASE.IDLE });
    const before = await rowsOf(game._id);

    await expect(action(game._id)).rejects.toMatchObject({ error: 403, reason: 'Admins only.' });

    expect(await rowsOf(game._id)).toEqual(before);
  });

  it('answers 404 for an unknown game', async () => {
    await asAdmin();
    await expect(action('nothing')).rejects.toMatchObject({
      error: 404,
      reason: 'Game not found.',
    });
  });
});

describe('adminEndGame', () => {
  beforeEach(() => asAdmin());

  it('ends a live game with nobody winning, through the claim', async () => {
    const game = await insertGame({ name: 'Race', gamePhase: PLAY, step: 7 });

    await endGame(game._id);

    const ended = await Games.findOneAsync(game._id);
    expect(ended.gamePhase).toBe(ENDED);
    expect(ended.winner).toBe('Nobody');
    expect(ended.winnerUserId).toBeUndefined();
    expect(ended.stopped).toEqual(expect.any(Number));
    expect(ended.step).toBe(8);
    expect(await messages(game._id)).toEqual(['An admin ended the game.']);
  });

  it('ends a parked game', async () => {
    const game = await insertGame({ resumeAttempts: MAX_RESUME_ATTEMPTS });

    await endGame(game._id);

    expect((await Games.findOneAsync(game._id)).gamePhase).toBe(ENDED);
  });

  it('refuses a game that has not started', async () => {
    const game = await insertGame({ started: false, gamePhase: GameState.PHASE.IDLE });

    await expect(endGame(game._id)).rejects.toMatchObject({
      error: 409,
      reason: 'This game has not started. Delete it instead.',
    });
    expect((await Games.findOneAsync(game._id)).gamePhase).toBe(GameState.PHASE.IDLE);
  });

  it('refuses a game that is already over, and leaves its winner alone', async () => {
    const game = await insertGame({ gamePhase: ENDED, winner: 'ann', winnerUserId: 'ann' });

    await expect(endGame(game._id)).rejects.toMatchObject({
      error: 409,
      reason: 'This game is already over.',
    });
    expect((await Games.findOneAsync(game._id)).winner).toBe('ann');
  });

  it('tries again on a fresh read when a driver claims first', async () => {
    const game = await insertGame({ gamePhase: PROGRAM });
    driverMovesOnRead(2);

    await endGame(game._id);

    expect((await Games.findOneAsync(game._id)).gamePhase).toBe(ENDED);
    expect(await messages(game._id)).toEqual(['An admin ended the game.']);
  });

  it('gives up after three lost claims and says so', async () => {
    const game = await insertGame({ gamePhase: PROGRAM });
    driverMovesOnRead(3);

    await expect(endGame(game._id)).rejects.toMatchObject({
      error: 409,
      reason: 'The game moved while it was being ended. Try again.',
    });
    expect((await Games.findOneAsync(game._id)).gamePhase).toBe(PROGRAM);
    expect(await messages(game._id)).toEqual([]);
  });
});

describe('adminDeleteGame', () => {
  beforeEach(() => asAdmin());

  it('deletes a lobby with its players, cards, deck and chat', async () => {
    const game = await gameWithRows({ started: false, gamePhase: GameState.PHASE.IDLE });

    await deleteGame(game._id);

    expect(await rowsOf(game._id)).toEqual({
      game: undefined,
      players: 0,
      cards: 0,
      decks: 0,
      chat: 0,
    });
  });

  it('deletes a game that is over, rows and all', async () => {
    const game = await gameWithRows({ gamePhase: ENDED, winner: 'Nobody' });

    await deleteGame(game._id);

    expect((await rowsOf(game._id)).game).toBeUndefined();
    expect((await rowsOf(game._id)).players).toBe(0);
  });

  it('refuses a running game and keeps every row', async () => {
    const game = await gameWithRows({ gamePhase: PLAY });
    const before = await rowsOf(game._id);

    await expect(deleteGame(game._id)).rejects.toMatchObject({
      error: 409,
      reason: 'End the game first.',
    });
    expect(await rowsOf(game._id)).toEqual(before);
  });

  it('refuses a parked game too', async () => {
    const game = await insertGame({ resumeAttempts: MAX_RESUME_ATTEMPTS });

    await expect(deleteGame(game._id)).rejects.toMatchObject({ error: 409 });
    expect(await Games.findOneAsync(game._id)).toBeDefined();
  });

  // No `buildHighscores()` after the delete: the method rebuilds the rankings itself.
  it('takes the win and the games played out of the rankings at once', async () => {
    await Meteor.users.insertAsync({ _id: 'ann', profile: { name: 'ann' } });
    await Meteor.users.insertAsync({ _id: 'bob', profile: { name: 'bob' } });
    const won = await insertGame({ gamePhase: ENDED, winner: 'ann', winnerUserId: 'ann' });
    await insertPlayer(won._id, { userId: 'ann', name: 'ann' });
    await insertPlayer(won._id, { userId: 'bob', name: 'bob' });
    for (let i = 0; i < 2; i++) {
      const other = await insertGame({ gamePhase: ENDED, winner: 'bob', winnerUserId: 'bob' });
      await insertPlayer(other._id, { userId: 'bob', name: 'bob' });
    }
    await buildHighscores();
    expect(await ranking('mostWon')).toEqual([
      { name: 'bob', value: 2 },
      { name: 'ann', value: 1 },
    ]);
    expect(await ranking('mostPlayed')).toEqual([
      { name: 'bob', value: 3 },
      { name: 'ann', value: 1 },
    ]);

    await deleteGame(won._id);

    expect(await ranking('mostWon')).toEqual([{ name: 'bob', value: 2 }]);
    expect(await ranking('mostPlayed')).toEqual([{ name: 'bob', value: 2 }]);
  });
});

describe('adminRenameGame', () => {
  beforeEach(() => asAdmin());

  it.each([
    ['a lobby', { started: false, gamePhase: GameState.PHASE.IDLE }],
    ['a running game', {}],
    ['a game that is over', { gamePhase: ENDED, winner: 'ann', winnerUserId: 'ann' }],
  ])('renames %s, trimmed, and moves nothing else', async (_, fields) => {
    const game = await gameWithRows({ gamePhase: PROGRAM, ...fields });
    const before = await rowsOf(game._id);

    await renameGame(game._id, '  Sunday Race  ');

    expect(await rowsOf(game._id)).toEqual({
      ...before,
      game: { ...before.game, name: 'Sunday Race' },
    });
  });

  it.each([
    ['an empty name', '   ', 'Name cannot be empty.'],
    ['a name over 40 characters', 'x'.repeat(41), 'Name must be at most 40 characters long.'],
  ])('refuses %s and keeps the old one', async (_, name, reason) => {
    const game = await gameWithRows();

    await expect(renameGame(game._id, name)).rejects.toMatchObject({ error: 400, reason });

    expect((await Games.findOneAsync(game._id)).name).toBe('Race');
  });
});
