// Shared fixtures for tests that exercise CardLogic/GameLogic/GameState through the
// real collection transforms (Games/Players/Cards/Decks), backed by the in-memory
// FakeCollection from test/setup.js. Each insert*/make* helper returns the freshly
// read-back, transform-wrapped instance (exactly what production code operates on),
// not the raw insert payload.
import { Games } from '../../collections/games.ts';
import { Players } from '../../collections/players.ts';
import { Cards } from '../../collections/cards.ts';
import { Decks } from '../../collections/deck.ts';
import { GameState } from '../../both/gamestate.ts';
import { GameLogic } from '../../both/gamelogic.ts';

export async function insertGame(overrides = {}) {
  const id = await Games.insertAsync({
    boardId: 0,
    gamePhase: GameState.PHASE.PROGRAM,
    playPhase: GameState.PLAY_PHASE.IDLE,
    playPhaseCount: 1,
    programRound: 1,
    waitingForRespawn: [],
    cardsToPlay: [],
    timer: -1,
    timerStartedAt: null,
    announce: false,
    started: true,
    step: 0,
    ...overrides,
  });
  return Games.findOneAsync(id);
}

export async function insertPlayer(gameId, overrides = {}) {
  const id = await Players.insertAsync({
    gameId,
    name: 'bot',
    userId: 'user_1',
    position: { x: 0, y: 0 },
    direction: GameLogic.UP,
    damage: 0,
    lives: 3,
    powerState: GameLogic.ON,
    needsRespawn: false,
    submitted: false,
    playedCardsCnt: 0,
    chosenCardsCnt: 0,
    cards: [-1, -1, -1, -1, -1],
    optionCards: {},
    optionalInstantPowerDown: false,
    visited_checkpoints: 0,
    shotDistance: 0,
    ...overrides,
  });
  return Players.findOneAsync(id);
}

export async function insertCards(playerId, gameId, overrides = {}) {
  const id = await Cards.insertAsync({
    playerId,
    gameId,
    userId: 'user_1',
    handCards: [],
    chosenCards: [-1, -1, -1, -1, -1],
    ...overrides,
  });
  return Cards.findOneAsync(id);
}

export async function insertDeck(gameId, overrides = {}) {
  const id = await Decks.insertAsync({
    gameId,
    cards: [],
    optionCards: [],
    discardedOptionCards: [],
    ...overrides,
  });
  return Decks.findOneAsync(id);
}
