import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { Board } from '../../both/board.js';
import { Tile } from '../../both/tile.js';
import { GameLogic } from '../../both/gamelogic.js';

beforeEach(() => resetFakeCollections());

// The Board constructor initializes the area cursor (`x_offset`/`y_offset`/`orientation`
// and `area_width`/`area_height`) to the identity placement, so the tile()-based helpers
// (setRoller/setGear/setPusher/setVoid/setRepair/setOption/addStart/addCheckpoint/
// addWall/addLaser) work on a bare board with raw, unrotated coordinates — the same state
// every real board recipe leaves behind once `addArea` has reset it.
function freshBoard(min_player, max_player, width, height) {
  return new Board('b', min_player, max_player, width, height);
}

describe('Board.to_dir', () => {
  it('passes numbers 0-3 through unchanged', () => {
    expect(Board.to_dir(0)).toBe(0);
    expect(Board.to_dir(1)).toBe(1);
    expect(Board.to_dir(2)).toBe(2);
    expect(Board.to_dir(3)).toBe(3);
  });

  it('wraps numbers above 3 with plain modulo (characterization: negative input is NOT wrapped into 0-3)', () => {
    expect(Board.to_dir(4)).toBe(0);
    expect(Board.to_dir(5)).toBe(1);
    // JS `%` keeps the sign of the dividend, so -1 % 4 === -1, not 3. There is no
    // extra `+4` here to correct it, unlike Tile#rotate.
    expect(Board.to_dir(-1)).toBe(-1);
    expect(Board.to_dir(-4)).toBe(-0); // -4 % 4 is negative zero in JS
  });

  it('maps direction words (short and long) to the numeric constant', () => {
    expect(Board.to_dir('u')).toBe(GameLogic.UP);
    expect(Board.to_dir('up')).toBe(GameLogic.UP);
    expect(Board.to_dir('r')).toBe(GameLogic.RIGHT);
    expect(Board.to_dir('right')).toBe(GameLogic.RIGHT);
    expect(Board.to_dir('d')).toBe(GameLogic.DOWN);
    expect(Board.to_dir('down')).toBe(GameLogic.DOWN);
    expect(Board.to_dir('l')).toBe(GameLogic.LEFT);
    expect(Board.to_dir('left')).toBe(GameLogic.LEFT);
  });

  it('derives a direction from a step vector, checking x before y', () => {
    expect(Board.to_dir({ x: 1, y: 0 })).toBe(GameLogic.RIGHT);
    expect(Board.to_dir({ x: -1, y: 0 })).toBe(GameLogic.LEFT);
    expect(Board.to_dir({ x: 0, y: 1 })).toBe(GameLogic.DOWN);
    expect(Board.to_dir({ x: 0, y: -1 })).toBe(GameLogic.UP);
    // x takes priority even if y is also non-zero.
    expect(Board.to_dir({ x: 1, y: 1 })).toBe(GameLogic.RIGHT);
  });

  it('returns undefined for the zero vector (characterization: no case matches)', () => {
    expect(Board.to_dir({ x: 0, y: 0 })).toBeUndefined();
  });
});

describe('Board.to_step', () => {
  it('produces a unit vector for each of the four directions', () => {
    expect(Board.to_step(GameLogic.UP)).toEqual({ x: 0, y: -1 });
    expect(Board.to_step(GameLogic.RIGHT)).toEqual({ x: 1, y: 0 });
    expect(Board.to_step(GameLogic.DOWN)).toEqual({ x: 0, y: 1 });
    expect(Board.to_step(GameLogic.LEFT)).toEqual({ x: -1, y: 0 });
  });

  it('round-trips through word directions', () => {
    expect(Board.to_step('up')).toEqual({ x: 0, y: -1 });
    expect(Board.to_step('r')).toEqual({ x: 1, y: 0 });
  });
});

describe('Board construction', () => {
  it('defaults to a 12x16 board of empty tiles, addressed [row][col]', () => {
    const board = new Board('default');
    expect(board.width).toBe(12);
    expect(board.height).toBe(16);
    expect(board.tiles).toHaveLength(16);
    expect(board.tiles[0]).toHaveLength(12);
    expect(board.getTile(0, 0)).toBeInstanceOf(Tile);
    expect(board.getTile(0, 0).type).toBe(Tile.EMPTY);
  });

  it('title-cases the name for display', () => {
    expect(new Board('risky_exchange').title).toBe('Risky Exchange');
  });

  it('accepts custom dimensions and player bounds', () => {
    const board = new Board('custom', 2, 6, 8, 10);
    expect(board.min_player).toBe(2);
    expect(board.max_player).toBe(6);
    expect(board.width).toBe(8);
    expect(board.height).toBe(10);
    expect(board.tiles).toHaveLength(10);
    expect(board.tiles[0]).toHaveLength(8);
  });
});

describe('onBoard / getTile', () => {
  it('reports in-bounds coordinates as on the board', () => {
    const board = new Board('b');
    expect(board.onBoard(0, 0)).toBe(true);
    expect(board.onBoard(11, 15)).toBe(true);
  });

  it('reports negative or over-sized coordinates as off the board', () => {
    const board = new Board('b');
    expect(board.onBoard(-1, 0)).toBe(false);
    expect(board.onBoard(0, -1)).toBe(false);
    expect(board.onBoard(12, 0)).toBe(false);
    expect(board.onBoard(0, 16)).toBe(false);
  });

  it('returns a fresh LIMBO tile (and warns) for out-of-bounds getTile', () => {
    const board = new Board('b');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tile = board.getTile(-1, -1);
    expect(tile.type).toBe(Tile.LIMBO);
    expect(warn).toHaveBeenCalledWith('Invalid board tile (-1,-1)');
    warn.mockRestore();
  });
});

describe('canMove', () => {
  it('is blocked by a wall on the origin tile facing the move direction', () => {
    const board = new Board('b');
    board.getTile(1, 1).addWall(GameLogic.RIGHT);
    expect(board.canMove(1, 1, GameLogic.RIGHT)).toBe(false);
    expect(board.canMove(1, 1, GameLogic.LEFT)).toBe(true);
  });

  it('is blocked by a wall on the target tile facing back at the origin', () => {
    const board = new Board('b');
    board.getTile(2, 1).addWall(GameLogic.LEFT); // wall on the tile being entered
    expect(board.canMove(1, 1, GameLogic.RIGHT)).toBe(false);
  });

  it('does NOT block movement off the edge of the board (characterization: edge-of-board is not a wall)', () => {
    const board = new Board('b');
    // getTile(-1, y) returns a fresh LIMBO tile with no wall, so canMove sees no
    // wall on either side and returns true — the board itself never stops a robot
    // from stepping off; that is enforced later via Board#onBoard in the collections
    // layer (Players#isOnBoardAsync).
    expect(board.canMove(0, 0, GameLogic.LEFT)).toBe(true);
    expect(board.canMove(0, 0, GameLogic.UP)).toBe(true);
  });

  it('accepts a step-vector direction as well as a numeric one', () => {
    const board = new Board('b');
    board.getTile(1, 1).addWall(GameLogic.RIGHT);
    expect(board.canMove(1, 1, { x: 1, y: 0 })).toBe(false);
  });
});

describe('addWall (board-level, area-relative)', () => {
  it('adds a wall on each side named in a hyphen-separated direction string', () => {
    const board = freshBoard();
    board.addWall(0, 0, 'up-left');
    expect(board.getTile(0, 0).hasWall(GameLogic.UP)).toBe(true);
    expect(board.getTile(0, 0).hasWall(GameLogic.LEFT)).toBe(true);
    expect(board.getTile(0, 0).hasWall(GameLogic.RIGHT)).toBeFalsy();
  });
});

describe('addLaser', () => {
  it('lays damage down the beam and walls off both ends', () => {
    const board = freshBoard();
    board.addLaser(0, 0, 'r', 3, 1);
    expect(board.getTile(0, 0).damage).toBe(1);
    expect(board.getTile(1, 0).damage).toBe(1);
    expect(board.getTile(2, 0).damage).toBe(1);
    expect(board.getTile(3, 0).damage).toBe(0); // beam stops after 3 tiles
    // walls at both ends of the beam, perpendicular to travel
    expect(board.getTile(0, 0).hasWall(GameLogic.LEFT)).toBe(true);
    expect(board.getTile(2, 0).hasWall(GameLogic.RIGHT)).toBe(true);
    // no wall in the middle of the beam
    expect(board.getTile(1, 0).hasWall(GameLogic.LEFT)).toBeFalsy();
    expect(board.getTile(1, 0).hasWall(GameLogic.RIGHT)).toBeFalsy();
  });

  it('addDoubleLaser is addLaser with strength 2', () => {
    const board = freshBoard();
    board.addDoubleLaser(0, 0, 'd', 2);
    expect(board.getTile(0, 0).damage).toBe(2);
    expect(board.getTile(0, 1).damage).toBe(2);
  });

  it('a single-tile laser walls off the same tile on both sides', () => {
    const board = freshBoard();
    board.addLaser(5, 5, 'r', 1);
    expect(board.getTile(5, 5).hasWall(GameLogic.LEFT)).toBe(true);
    expect(board.getTile(5, 5).hasWall(GameLogic.RIGHT)).toBe(true);
  });
});

describe('setRoller', () => {
  it('sets a straight roller with direction and speed', () => {
    const board = freshBoard();
    board.setRoller(0, 0, 'r');
    const tile = board.getTile(0, 0);
    expect(tile.type).toBe(Tile.ROLLER);
    expect(tile.roller_type).toBe('straight');
    expect(tile.speed).toBe(1);
    expect(tile.direction).toBe(GameLogic.RIGHT);
    expect(tile.move).toEqual({ x: 1, y: 0 });
  });

  it('setExpressRoller sets speed 2', () => {
    const board = freshBoard();
    board.setExpressRoller(0, 0, 'r');
    expect(board.getTile(0, 0).speed).toBe(2);
  });

  it('splits a turn across two tiles: `.rotate` lands on the tile being LEFT, `roller_type` cw/ccw lands on the tile being ENTERED (characterization)', () => {
    const board = freshBoard();
    // route 'ur' from (0,3): the belt runs up from (0,3) onto (0,2), then continues
    // right. `this.tile(x,y).rotate` is mutated using the *pre-move* (x,y) — so the
    // physics rotation (applied by GameLogic when a robot leaves this tile) sits on
    // the origin tile (0,3) — while `setRollerTileProp`'s roller_type (the bend art)
    // is written to the tile the belt just moved onto, (0,2).
    board.setRoller(0, 3, 'ur');
    const originTile = board.getTile(0, 3);
    const bendTile = board.getTile(0, 2);
    // u -> r is a clockwise turn (UP=0 -> RIGHT=1, rot = 1-0 = 1)
    expect(originTile.roller_type).toBe('straight');
    expect(originTile.direction).toBe(GameLogic.UP);
    expect(originTile.rotate).toBe(1);
    expect(bendTile.type).toBe(Tile.ROLLER);
    expect(bendTile.direction).toBe(GameLogic.RIGHT);
    expect(bendTile.roller_type).toBe('cw');
  });

  it('marks a counter-clockwise turn the other way round', () => {
    const board = freshBoard();
    // route 'ru' from (5,5): r -> u is RIGHT(1) -> UP(0), rot = 0 - 1 = -1 -> ccw.
    board.setRoller(5, 5, 'ru');
    const originTile = board.getTile(5, 5);
    const bendTile = board.getTile(6, 5);
    expect(originTile.roller_type).toBe('straight');
    expect(originTile.rotate).toBe(-1);
    expect(bendTile.roller_type).toBe('ccw');
    expect(bendTile.direction).toBe(GameLogic.UP);
  });

  it('merges two rollers crossing the same tile into a sorted, hyphenated compound roller_type', () => {
    const board = freshBoard();
    // Roller A: straight, heading right through (0,0),(1,0),(2,0) — roller_type
    // 'straight' at (1,0).
    board.setRoller(0, 0, 'rrr');
    // Roller B: up from (1,2) through (1,1), then turns right into (1,0) — arrives
    // at (1,0) with the 'cw' bend type computed for that turn.
    board.setRoller(1, 2, 'uur');

    const crossTile = board.getTile(1, 0);
    // setRollerTileProp only merges when the tile is already a different roller_type;
    // 'cw' and 'straight' sort alphabetically and join with a hyphen.
    expect(crossTile.roller_type).toBe('cw-straight');
    expect(crossTile.type).toBe(Tile.ROLLER);
    // The second roller's turn direction (into (1,0)) wins for direction/move, since
    // setRollerTileProp always overwrites those fields unconditionally.
    expect(crossTile.direction).toBe(GameLogic.RIGHT);
    expect(crossTile.move).toEqual({ x: 1, y: 0 });
    // The `.rotate` physics field for the turn itself lands on (1,1), the tile being
    // left when roller B turns — NOT on the merged crossing tile.
    expect(board.getTile(1, 1).rotate).toBe(1);
  });
});

describe('setGear', () => {
  it('sets rotate +1 for cw and -1 for ccw', () => {
    const board = freshBoard();
    board.setGear(0, 0, 'cw');
    expect(board.getTile(0, 0).type).toBe(Tile.GEAR);
    expect(board.getTile(0, 0).rotate).toBe(1);

    board.setGear(1, 0, 'ccw');
    expect(board.getTile(1, 0).rotate).toBe(-1);
  });
});

describe('setPusher', () => {
  it('sets push direction/move and walls off the side it pushes from', () => {
    const board = freshBoard();
    board.setPusher(0, 0, 'down', 'even');
    const tile = board.getTile(0, 0);
    expect(tile.type).toBe(Tile.PUSHER);
    expect(tile.pusher_type).toBe(0);
    expect(tile.direction).toBe(GameLogic.DOWN);
    expect(tile.move).toEqual({ x: 0, y: 1 });
    // a pusher wall sits opposite its push direction, like a real RoboRally pusher
    expect(tile.hasWall(GameLogic.UP)).toBe(true);
  });

  it('maps the odd/even pusher_type strings to 1/0', () => {
    const board = freshBoard();
    board.setPusher(0, 0, 'up', 'odd');
    expect(board.getTile(0, 0).pusher_type).toBe(1);
  });
});

describe('setVoid', () => {
  it('marks a tile void with no void_type when it has no void neighbours', () => {
    const board = freshBoard();
    board.setVoid(5, 5);
    expect(board.getTile(5, 5).type).toBe(Tile.VOID);
    expect(board.getTile(5, 5).void_type).toBe('');
  });

  it('links adjacent void tiles: each rotates to face its neighbour "up" locally, recording the absolute rotation in `.direction` (characterization)', () => {
    const board = freshBoard();
    board.setVoid(5, 5);
    board.setVoid(6, 5); // to the right of the first; setVoid(6,5) is what links both,
    // since a tile only learns about a void neighbour once THAT neighbour also exists.
    const left = board.getTile(5, 5);
    const right = board.getTile(6, 5);
    // void_type only encodes the relative topology (here: one void neighbour, always
    // described as "up" in the tile's own rotated frame) — not an absolute compass
    // word. The absolute rotation needed to make that true is `.direction`, and the
    // two tiles rotate opposite ways to face each other.
    expect(left.void_type).toBe('-up');
    expect(right.void_type).toBe('-up');
    expect(left.direction).toBe(GameLogic.RIGHT);
    expect(right.direction).toBe(GameLogic.LEFT);
  });
});

describe('setRepair / setOption', () => {
  it('setRepair marks the tile repairable and typed REPAIR', () => {
    const board = freshBoard();
    board.setRepair(3, 3);
    expect(board.getTile(3, 3).repair).toBe(true);
    expect(board.getTile(3, 3).type).toBe(Tile.REPAIR);
  });

  it('setOption marks the tile repairable, optional and typed OPTION', () => {
    const board = freshBoard();
    board.setOption(4, 4);
    expect(board.getTile(4, 4).repair).toBe(true);
    expect(board.getTile(4, 4).option).toBe(true);
    expect(board.getTile(4, 4).type).toBe(Tile.OPTION);
  });
});

describe('addCheckpoint', () => {
  it('numbers checkpoints in call order and clears `finish` on the previous one', () => {
    const board = freshBoard();
    board.addCheckpoint(1, 1);
    board.addCheckpoint(2, 2);
    expect(board.checkpoints).toEqual([
      { x: 1, y: 1, number: 1 },
      { x: 2, y: 2, number: 2 },
    ]);
    // addCheckpoint(2,2) turned off `finish` on the (1,1) tile...
    expect(board.getTile(1, 1).finish).toBe(false);
    // ...but addCheckpoint always sets it back on for the tile it's called on, via
    // Tile#addCheckpoint, so the LAST checkpoint stays a finish line.
    expect(board.getTile(2, 2).finish).toBe(true);
    expect(board.getTile(2, 2).checkpoint).toBe(2);
    expect(board.getTile(2, 2).repair).toBe(true);
  });
});
