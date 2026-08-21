import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { insertGame, insertPlayer, insertCards, insertDeck } from '../helpers/fixtures.js';
import { GameLogic } from '../../both/gamelogic.js';
import { Board } from '../../both/board.js';
import { Tile } from '../../both/tile.js';
import { BoardBox } from '../../both/board_box.js';
import { Games } from '../../collections/games.js';
import { Players } from '../../collections/players.js';
import { Cards } from '../../collections/cards.js';
import { Deck } from '../../collections/deck.js';
import { Chat } from '../../collections/chat.js';

// GameLogic always reaches the board through `player.boardAsync() -> game.board() ->
// BoardBox.getBoard(boardId)`. Stubbing BoardBox.getBoard lets every test build an
// exact, minimal board with `new Board(...)` + direct tile mutation, independent of
// the real catalog (see MODERNIZATION.local.md: "mocking the thin collection
// touchpoints" was the intended seam for exercising GameLogic).
function stubBoard(width = 6, height = 6) {
  const board = new Board('gamelogic-test', 1, 8, width, height);
  vi.spyOn(BoardBox, 'getBoard').mockReturnValue(board);
  return board;
}

// 8-player-deck card ids for the seven card types (see cardlogic_pure.test.js).
const CARD = {
  U_TURN: 0,
  TURN_RIGHT: 6,
  TURN_LEFT: 24,
  STEP_BACKWARD: 42,
  STEP_FORWARD: 48,
  STEP_FORWARD_2: 66,
  STEP_FORWARD_3: 78,
};

beforeEach(() => resetFakeCollections());
afterEach(() => vi.restoreAllMocks());

describe('playCard: turning (position 0 — no movement)', () => {
  it('rotates in place and persists, without moving', async () => {
    stubBoard();
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      direction: GameLogic.UP,
      position: { x: 2, y: 2 },
    });

    await GameLogic.playCard(player, CARD.U_TURN);

    const doc = await Players.findOneAsync(player._id);
    expect(doc.direction).toBe(GameLogic.DOWN); // UP + 180
    expect(doc.position).toEqual({ x: 2, y: 2 });
  });

  it('turn-right/turn-left rotate by +-90 degrees', async () => {
    stubBoard();
    const game = await insertGame();
    const right = await insertPlayer(game._id, { direction: GameLogic.UP });
    const left = await insertPlayer(game._id, { direction: GameLogic.UP });

    await GameLogic.playCard(right, CARD.TURN_RIGHT);
    await GameLogic.playCard(left, CARD.TURN_LEFT);

    expect((await Players.findOneAsync(right._id)).direction).toBe(GameLogic.RIGHT);
    expect((await Players.findOneAsync(left._id)).direction).toBe(GameLogic.LEFT);
  });

  it('does nothing for a player who needs to respawn', async () => {
    stubBoard();
    const game = await insertGame();
    const player = await insertPlayer(game._id, { needsRespawn: true, direction: GameLogic.UP });

    await GameLogic.playCard(player, CARD.U_TURN);

    expect((await Players.findOneAsync(player._id)).direction).toBe(GameLogic.UP); // unchanged
  });
});

describe('playCard: straight-line movement', () => {
  it('moves forward by the number of steps on the card', async () => {
    stubBoard();
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 1, y: 1 },
    });

    await GameLogic.playCard(player, CARD.STEP_FORWARD_2);

    expect((await Players.findOneAsync(player._id)).position).toEqual({ x: 3, y: 1 });
  });

  it('step-backward moves opposite the facing direction without rotating', async () => {
    stubBoard();
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 3, y: 1 },
    });

    await GameLogic.playCard(player, CARD.STEP_BACKWARD);

    const doc = await Players.findOneAsync(player._id);
    expect(doc.position).toEqual({ x: 2, y: 1 });
    expect(doc.direction).toBe(GameLogic.RIGHT);
  });

  it('a wall stops movement dead — no partial step, no DB write', async () => {
    const board = stubBoard();
    board.getTile(1, 1).addWall(GameLogic.RIGHT);
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 1, y: 1 },
    });

    await GameLogic.playCard(player, CARD.STEP_FORWARD);

    expect((await Players.findOneAsync(player._id)).position).toEqual({ x: 1, y: 1 });
  });
});

describe('playCard: pushing', () => {
  it('pushes a robot ahead of it by the same step', async () => {
    stubBoard();
    const game = await insertGame();
    const mover = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 1, y: 1 },
    });
    const pushed = await insertPlayer(game._id, {
      direction: GameLogic.UP,
      position: { x: 2, y: 1 },
    });

    await GameLogic.playCard(mover, CARD.STEP_FORWARD);

    expect((await Players.findOneAsync(mover._id)).position).toEqual({ x: 2, y: 1 });
    expect((await Players.findOneAsync(pushed._id)).position).toEqual({ x: 3, y: 1 });
  });

  it('a blocked pushed robot blocks the pusher too (the whole chain fails together)', async () => {
    const board = stubBoard();
    board.getTile(2, 1).addWall(GameLogic.RIGHT); // pushed robot can't continue right
    const game = await insertGame();
    const mover = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 1, y: 1 },
    });
    const pushed = await insertPlayer(game._id, {
      direction: GameLogic.UP,
      position: { x: 2, y: 1 },
    });

    await GameLogic.playCard(mover, CARD.STEP_FORWARD);

    expect((await Players.findOneAsync(mover._id)).position).toEqual({ x: 1, y: 1 });
    expect((await Players.findOneAsync(pushed._id)).position).toEqual({ x: 2, y: 1 });
  });

  it('ramming_gear damages the pushed robot as it is pushed', async () => {
    stubBoard();
    const game = await insertGame();
    const mover = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 1, y: 1 },
      optionCards: { ramming_gear: true },
    });
    const pushed = await insertPlayer(game._id, {
      direction: GameLogic.UP,
      position: { x: 2, y: 1 },
      damage: 0,
    });

    await GameLogic.playCard(mover, CARD.STEP_FORWARD);

    expect((await Players.findOneAsync(pushed._id)).damage).toBe(1);
  });
});

describe('playCard: falling off the board / into a void', () => {
  it('walking into a void kills the robot: loses a life, parks off-board, returns hand cards to the deck', async () => {
    vi.useFakeTimers();
    const board = stubBoard();
    board.getTile(3, 1).type = Tile.VOID;
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 2, y: 1 },
      lives: 3,
      damage: 4,
    });
    await insertCards(player._id, game._id, { handCards: [11, 12] });
    await insertDeck(game._id, { cards: [1, 2, 3] });

    const cardPromise = GameLogic.playCard(player, CARD.STEP_FORWARD);
    await vi.advanceTimersByTimeAsync(2000); // clears the 1s removePlayerWithDelay pause
    await cardPromise;

    const doc = await Players.findOneAsync(player._id);
    expect(doc.lives).toBe(2);
    expect(doc.damage).toBe(2); // reset to 2 on death (no superior_archive option)
    expect(doc.needsRespawn).toBe(true);
    expect(doc.position).toEqual({ x: board.width - 1, y: board.height }); // parked, lives > 0
    expect(doc.direction).toBe(GameLogic.UP);

    const gameDoc = await Games.findOneAsync(game._id);
    expect(gameDoc.waitingForRespawn).toContain(player._id);

    const chat = await Chat.find({ gameId: game._id }).fetchAsync();
    expect(chat.some((m) => m.message.includes('died!'))).toBe(true);

    const cardsDoc = await Cards.findOneAsync({ playerId: player._id });
    expect(cardsDoc.handCards).toEqual([]);
    const deckDoc = await Deck.findOneAsync({ gameId: game._id });
    expect([...deckDoc.cards].sort((a, b) => a - b)).toEqual([1, 2, 3, 11, 12]);

    vi.useRealTimers();
  });

  it('the superior_archive option skips the damage-2 reset on death', async () => {
    vi.useFakeTimers();
    const board = stubBoard();
    board.getTile(3, 1).type = Tile.VOID;
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 2, y: 1 },
      optionCards: { superior_archive: true },
    });
    await insertCards(player._id, game._id, { handCards: [] });
    await insertDeck(game._id, { cards: [] });
    void board;

    const cardPromise = GameLogic.playCard(player, CARD.STEP_FORWARD);
    await vi.advanceTimersByTimeAsync(2000);
    await cardPromise;

    expect((await Players.findOneAsync(player._id)).damage).toBe(0);
    vi.useRealTimers();
  });

  it('a permanently eliminated robot (0 lives left) parks along the bottom-left instead of the bottom-right', async () => {
    vi.useFakeTimers();
    const board = stubBoard();
    board.getTile(3, 1).type = Tile.VOID;
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      direction: GameLogic.RIGHT,
      position: { x: 2, y: 1 },
      lives: 1, // this death brings lives to 0
    });
    await insertCards(player._id, game._id, { handCards: [] });
    await insertDeck(game._id, { cards: [] });

    const cardPromise = GameLogic.playCard(player, CARD.STEP_FORWARD);
    await vi.advanceTimersByTimeAsync(2000);
    await cardPromise;

    const doc = await Players.findOneAsync(player._id);
    expect(doc.lives).toBe(0);
    expect(doc.position).toEqual({ x: 0, y: board.height }); // first eliminated -> column 0
    const gameDoc = await Games.findOneAsync(game._id);
    // out-of-lives players are never queued to respawn
    expect(gameDoc.waitingForRespawn).not.toContain(player._id);
  });
});

describe('executeRollers', () => {
  it('moves a robot one tile in the roller direction and applies its rotate', async () => {
    const board = stubBoard();
    board.getTile(1, 1).type = Tile.ROLLER;
    board.getTile(1, 1).move = { x: 1, y: 0 };
    board.getTile(1, 1).rotate = 1;
    void board;
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      position: { x: 1, y: 1 },
      direction: GameLogic.UP,
    });

    await GameLogic.executeRollers([await Players.findOneAsync(player._id)]);

    const doc = await Players.findOneAsync(player._id);
    expect(doc.position).toEqual({ x: 2, y: 1 });
    expect(doc.direction).toBe(GameLogic.RIGHT); // rotated +1 from UP
  });

  it('cancels two roller moves that would land on the same tile (both stay put)', async () => {
    const board = stubBoard();
    board.getTile(1, 1).type = Tile.ROLLER;
    board.getTile(1, 1).move = { x: 1, y: 0 }; // -> (2,1)
    board.getTile(3, 1).type = Tile.ROLLER;
    board.getTile(3, 1).move = { x: -1, y: 0 }; // -> (2,1), same target
    const game = await insertGame();
    const a = await insertPlayer(game._id, { position: { x: 1, y: 1 } });
    const b = await insertPlayer(game._id, { position: { x: 3, y: 1 } });

    await GameLogic.executeRollers(await Players.find({ gameId: game._id }).fetchAsync());

    expect((await Players.findOneAsync(a._id)).position).toEqual({ x: 1, y: 1 });
    expect((await Players.findOneAsync(b._id)).position).toEqual({ x: 3, y: 1 });
  });

  it('a stationary robot blocks a roller move that would land on it', async () => {
    const board = stubBoard();
    board.getTile(1, 1).type = Tile.ROLLER;
    board.getTile(1, 1).move = { x: 1, y: 0 }; // -> (2,1)
    void board;
    const game = await insertGame();
    const moving = await insertPlayer(game._id, { position: { x: 1, y: 1 } });
    const stationary = await insertPlayer(game._id, { position: { x: 2, y: 1 } }); // not on a roller

    await GameLogic.executeRollers(await Players.find({ gameId: game._id }).fetchAsync());

    expect((await Players.findOneAsync(moving._id)).position).toEqual({ x: 1, y: 1 });
    expect((await Players.findOneAsync(stationary._id)).position).toEqual({ x: 2, y: 1 });
  });

  it('executeExpressRollers only moves speed-2 rollers', async () => {
    const board = stubBoard();
    board.getTile(1, 1).type = Tile.ROLLER;
    board.getTile(1, 1).move = { x: 1, y: 0 };
    board.getTile(1, 1).speed = 1; // NOT express
    void board;
    const game = await insertGame();
    const player = await insertPlayer(game._id, { position: { x: 1, y: 1 } });

    await GameLogic.executeExpressRollers([await Players.findOneAsync(player._id)]);

    expect((await Players.findOneAsync(player._id)).position).toEqual({ x: 1, y: 1 });
  });
});

describe('executeGears', () => {
  it('rotates a robot standing on a gear tile by the tile rotate amount', async () => {
    const board = stubBoard();
    board.getTile(1, 1).type = Tile.GEAR;
    board.getTile(1, 1).rotate = -1;
    void board;
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      position: { x: 1, y: 1 },
      direction: GameLogic.UP,
    });

    await GameLogic.executeGears([await Players.findOneAsync(player._id)]);

    expect((await Players.findOneAsync(player._id)).direction).toBe(GameLogic.LEFT);
  });

  it('leaves a robot off a gear tile untouched', async () => {
    stubBoard();
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      position: { x: 1, y: 1 },
      direction: GameLogic.UP,
    });

    await GameLogic.executeGears([await Players.findOneAsync(player._id)]);

    expect((await Players.findOneAsync(player._id)).direction).toBe(GameLogic.UP);
  });
});

describe('executePushers', () => {
  it('only activates a pusher matching the play phase count parity, and pushes players in its direction', async () => {
    const board = stubBoard();
    board.getTile(1, 1).type = Tile.PUSHER;
    board.getTile(1, 1).pusher_type = 1; // 'odd'
    board.getTile(1, 1).move = { x: 0, y: 1 };
    void board;
    const oddGame = await insertGame({ playPhaseCount: 1 }); // 1 % 2 === 1 -> matches 'odd'
    const onOddPhase = await insertPlayer(oddGame._id, { position: { x: 1, y: 1 } });

    await GameLogic.executePushers(await Players.find({ gameId: oddGame._id }).fetchAsync());

    expect((await Players.findOneAsync(onOddPhase._id)).position).toEqual({ x: 1, y: 2 });
  });

  it('does not activate on the non-matching phase count parity', async () => {
    const board = stubBoard();
    board.getTile(1, 1).type = Tile.PUSHER;
    board.getTile(1, 1).pusher_type = 1; // 'odd'
    board.getTile(1, 1).move = { x: 0, y: 1 };
    void board;
    const evenGame = await insertGame({ playPhaseCount: 2 }); // 2 % 2 === 0 -> does not match 'odd'
    const onEvenPhase = await insertPlayer(evenGame._id, { position: { x: 1, y: 1 } });

    await GameLogic.executePushers(await Players.find({ gameId: evenGame._id }).fetchAsync());

    expect((await Players.findOneAsync(onEvenPhase._id)).position).toEqual({ x: 1, y: 1 });
  });
});

describe('executeLasers', () => {
  it('applies floor-laser damage to a robot standing on a damaging tile', async () => {
    const board = stubBoard();
    board.getTile(1, 1).damage = 1;
    void board;
    const game = await insertGame();
    const player = await insertPlayer(game._id, { position: { x: 1, y: 1 }, damage: 0 });

    await GameLogic.executeLasers([await Players.findOneAsync(player._id)]);

    expect((await Players.findOneAsync(player._id)).damage).toBe(1);
  });

  it('shoots the nearest robot in the facing direction with a clear line of sight', async () => {
    stubBoard();
    const game = await insertGame();
    const shooter = await insertPlayer(game._id, {
      position: { x: 0, y: 0 },
      direction: GameLogic.RIGHT,
    });
    const victim = await insertPlayer(game._id, { position: { x: 3, y: 0 }, damage: 0 });
    void shooter;

    await GameLogic.executeLasers(await Players.find({ gameId: game._id }).fetchAsync());

    expect((await Players.findOneAsync(victim._id)).damage).toBe(1);
  });

  it('a wall blocks the laser beam', async () => {
    const board = stubBoard();
    board.getTile(1, 0).addWall(GameLogic.RIGHT);
    void board;
    const game = await insertGame();
    const shooter = await insertPlayer(game._id, {
      position: { x: 0, y: 0 },
      direction: GameLogic.RIGHT,
    });
    const victim = await insertPlayer(game._id, { position: { x: 3, y: 0 }, damage: 0 });
    void shooter;

    await GameLogic.executeLasers(await Players.find({ gameId: game._id }).fetchAsync());

    expect((await Players.findOneAsync(victim._id)).damage).toBe(0);
  });

  it('rear-firing_laser also shoots a second victim directly behind the robot', async () => {
    stubBoard();
    const game = await insertGame();
    const shooter = await insertPlayer(game._id, {
      position: { x: 2, y: 0 },
      direction: GameLogic.RIGHT,
      optionCards: { 'rear-firing_laser': true },
    });
    void shooter;
    const front = await insertPlayer(game._id, { position: { x: 4, y: 0 }, damage: 0 });
    const behind = await insertPlayer(game._id, { position: { x: 0, y: 0 }, damage: 0 });

    await GameLogic.executeLasers(await Players.find({ gameId: game._id }).fetchAsync());

    expect((await Players.findOneAsync(front._id)).damage).toBe(1);
    expect((await Players.findOneAsync(behind._id)).damage).toBe(1);
  });

  it('a powered-down robot never fires its laser', async () => {
    stubBoard();
    const game = await insertGame();
    const poweredDown = await insertPlayer(game._id, {
      position: { x: 0, y: 0 },
      direction: GameLogic.RIGHT,
      powerState: GameLogic.OFF,
    });
    const inLineOfFire = await insertPlayer(game._id, { position: { x: 3, y: 0 }, damage: 0 });
    void poweredDown;

    await GameLogic.executeLasers(await Players.find({ gameId: game._id }).fetchAsync());

    expect((await Players.findOneAsync(inLineOfFire._id)).damage).toBe(0);
  });
});

// Rules.pdf p.8 ("Repairs & Upgrades"): every repair space discards 1 Damage token,
// and a wrench/hammer (option) space also draws an Option card. Checkpoint flags count
// as single repair sites — setup places a number sticker and a single wrench on each
// flag. (Until 2026-08-21 a plain repair tile healed 3; that was the Milestone 3
// characterization, now fixed to the rule.)
describe('executeRepairs', () => {
  it('a plain repair tile heals 1 damage', async () => {
    const board = stubBoard();
    board.getTile(1, 1).repair = true;
    void board;
    const game = await insertGame();
    const player = await insertPlayer(game._id, { position: { x: 1, y: 1 }, damage: 5 });

    await GameLogic.executeRepairs([await Players.findOneAsync(player._id)]);

    expect((await Players.findOneAsync(player._id)).damage).toBe(4);
  });

  it('never heals below 0 damage', async () => {
    const board = stubBoard();
    board.getTile(1, 1).repair = true;
    void board;
    const game = await insertGame();
    const player = await insertPlayer(game._id, { position: { x: 1, y: 1 }, damage: 0 });

    await GameLogic.executeRepairs([await Players.findOneAsync(player._id)]);

    expect((await Players.findOneAsync(player._id)).damage).toBe(0);
  });

  it('a checkpoint tile heals 1 damage (its flag carries a single wrench), and only once despite also carrying `.repair`', async () => {
    const board = stubBoard();
    board.getTile(1, 1).addCheckpoint(1); // sets checkpoint=1 AND repair=true
    void board;
    const game = await insertGame();
    const player = await insertPlayer(game._id, { position: { x: 1, y: 1 }, damage: 5 });

    await GameLogic.executeRepairs([await Players.findOneAsync(player._id)]);

    expect((await Players.findOneAsync(player._id)).damage).toBe(4); // -1 once, not -2
  });

  it('an option tile draws a card and heals 1, taking priority over its own `.repair` flag', async () => {
    const board = stubBoard();
    board.getTile(1, 1).option = true;
    board.getTile(1, 1).repair = true; // setOption always sets both
    void board;
    const game = await insertGame();
    const player = await insertPlayer(game._id, {
      position: { x: 1, y: 1 },
      damage: 5,
      optionCards: {},
    });
    await insertDeck(game._id, { optionCards: [2] }); // getOptionName(2) = 'rear-firing_laser'

    await GameLogic.executeRepairs([await Players.findOneAsync(player._id)]);

    const doc = await Players.findOneAsync(player._id);
    expect(doc.damage).toBe(4); // -1 once, not -2
    expect(doc.optionCards['rear-firing_laser']).toBe(true);
    // The draw happens inside the repairs phase with no other visual, so it must
    // announce itself (with the card's display title) in chat.
    const messages = (await Chat.find({ gameId: game._id }).fetchAsync()).map((c) => c.message);
    expect(messages).toContain('bot drew option card Rear-firing Laser');
    const deckDoc = await Deck.findOneAsync({ gameId: game._id });
    expect(deckDoc.optionCards).toEqual([]);
  });
});
