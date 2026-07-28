import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { Tile } from '../../both/tile.js';
import { GameLogic } from '../../both/gamelogic.js';

beforeEach(() => resetFakeCollections());

describe('Tile construction', () => {
  it('defaults to an empty tile facing up with no wall', () => {
    const tile = new Tile();
    expect(tile.type).toBe(Tile.EMPTY);
    expect(tile.wall).toBe(false);
    expect(tile.void_neighbour).toEqual([false, false, false, false]);
    expect(tile.items).toEqual([]);
    expect(tile.damage).toBe(0);
    expect(tile.direction).toBe(GameLogic.UP);
  });

  it('accepts an explicit type', () => {
    expect(new Tile(Tile.VOID).type).toBe(Tile.VOID);
  });
});

describe('hasWall', () => {
  it('is false on every side for a fresh tile (characterization: falsy wall object, not false)', () => {
    const tile = new Tile();
    // this.wall starts as boolean `false`, so `this.wall && this.wall[dir]` short-circuits
    // to `false` rather than throwing — worth locking in since it looks like it could NPE.
    expect(tile.hasWall(GameLogic.UP)).toBe(false);
    expect(tile.hasWall(GameLogic.RIGHT)).toBe(false);
  });

  it('is true only for the added side after addWall (characterization: unset sides read back as undefined, not false, once `wall` becomes an object)', () => {
    const tile = new Tile();
    tile.addWall(GameLogic.RIGHT);
    expect(tile.hasWall(GameLogic.RIGHT)).toBe(true);
    expect(tile.hasWall(GameLogic.UP)).toBeFalsy();
    expect(tile.hasWall(GameLogic.UP)).toBeUndefined();
    expect(tile.hasWall(GameLogic.DOWN)).toBeFalsy();
    expect(tile.hasWall(GameLogic.LEFT)).toBeFalsy();
  });

  it('accumulates multiple walls on the same tile', () => {
    const tile = new Tile();
    tile.addWall(GameLogic.UP);
    tile.addWall(GameLogic.LEFT);
    expect(tile.hasWall(GameLogic.UP)).toBe(true);
    expect(tile.hasWall(GameLogic.LEFT)).toBe(true);
    expect(tile.hasWall(GameLogic.RIGHT)).toBeFalsy();
  });
});

describe('addWall', () => {
  it('records a wall item with direction relative to the tile orientation', () => {
    const tile = new Tile();
    tile.direction = GameLogic.RIGHT; // e.g. a rotated void tile
    tile.addWall(GameLogic.UP);
    const [item] = tile.items;
    expect(item.path).toBe('/tiles/wall.png');
    // direction - this.direction: UP(0) - RIGHT(1) = -1
    expect(item.direction).toBe(-1);
  });
});

describe('addLaser', () => {
  it('sets damage and item type per strength (1/2/3 -> laser/doublelaser/triplelaser)', () => {
    const single = new Tile();
    single.addLaser(GameLogic.UP, 1);
    expect(single.damage).toBe(1);
    expect(single.items[0].path).toBe('/tiles/laser.png');

    const double = new Tile();
    double.addLaser(GameLogic.UP, 2);
    expect(double.damage).toBe(2);
    expect(double.items[0].path).toBe('/tiles/doublelaser.png');

    const triple = new Tile();
    triple.addLaser(GameLogic.UP, 3);
    expect(triple.damage).toBe(3);
    expect(triple.items[0].path).toBe('/tiles/triplelaser.png');
  });

  it('falls back to a single laser item for any strength other than 2 or 3 (characterization)', () => {
    const weird = new Tile();
    weird.addLaser(GameLogic.UP, 99);
    expect(weird.items[0].path).toBe('/tiles/laser.png');
  });
});

describe('addCheckpoint / addStart', () => {
  it('marks the tile as a finishable repair-on-arrival checkpoint', () => {
    const tile = new Tile();
    tile.addCheckpoint(3);
    expect(tile.checkpoint).toBe(3);
    expect(tile.finish).toBe(true);
    expect(tile.repair).toBe(true);
  });

  it('records the start slot number', () => {
    const tile = new Tile();
    tile.addStart(5);
    expect(tile.start).toBe(5);
  });
});

describe('setType / description', () => {
  it('describes a normal vs express roller differently', () => {
    const normal = new Tile();
    normal.setType(Tile.ROLLER);
    expect(normal.description).toMatch(/move 1 space/);

    const express = new Tile();
    express.speed = 2;
    express.setType(Tile.ROLLER);
    expect(express.description).toMatch(/move 2 spaces/);
  });

  it('describes gear rotation direction from gear_type', () => {
    const cw = new Tile();
    cw.gear_type = 'cw';
    cw.setType(Tile.GEAR);
    expect(cw.description).toContain('turn you right');

    const ccw = new Tile();
    ccw.gear_type = 'ccw';
    ccw.setType(Tile.GEAR);
    expect(ccw.description).toContain('turn you left');
  });

  it('describes pusher active cards from pusher_type', () => {
    const even = new Tile();
    even.pusher_type = 0;
    even.setType(Tile.PUSHER);
    expect(even.description).toContain('2 or 4');

    const odd = new Tile();
    odd.pusher_type = 1;
    odd.setType(Tile.PUSHER);
    expect(odd.description).toContain('1, 3 or 5');
  });

  it('gives void/repair/option each a fixed description', () => {
    const voidTile = new Tile();
    voidTile.setType(Tile.VOID);
    expect(voidTile.description).toMatch(/hole in the ground/);

    const repair = new Tile();
    repair.setType(Tile.REPAIR);
    expect(repair.description).toMatch(/one damage will be repaired/);

    const option = new Tile();
    option.setType(Tile.OPTION);
    expect(option.description).toMatch(/draw one option card/);
  });

  it('leaves description undefined for types with no case (characterization)', () => {
    const empty = new Tile();
    empty.setType(Tile.EMPTY);
    expect(empty.description).toBeUndefined();
  });
});

describe('path()', () => {
  it('builds gear/pusher/roller/void paths from their sub-type fields', () => {
    const gear = new Tile();
    gear.gear_type = 'cw';
    gear.setType(Tile.GEAR);
    expect(gear.path()).toBe('/tiles/gear-cw.jpg');

    const pusherEven = new Tile();
    pusherEven.pusher_type = 0;
    pusherEven.setType(Tile.PUSHER);
    expect(pusherEven.path()).toBe('/tiles/pusher-even.jpg');

    const pusherOdd = new Tile();
    pusherOdd.pusher_type = 1;
    pusherOdd.setType(Tile.PUSHER);
    expect(pusherOdd.path()).toBe('/tiles/pusher-odd.jpg');

    const roller = new Tile();
    roller.roller_type = 'straight';
    roller.setType(Tile.ROLLER);
    expect(roller.path()).toBe('/tiles/roller-straight.jpg');

    const expressRoller = new Tile();
    expressRoller.roller_type = 'cw';
    expressRoller.speed = 2;
    expressRoller.setType(Tile.ROLLER);
    expect(expressRoller.path()).toBe('/tiles/roller-express-cw.jpg');

    const voidTile = new Tile();
    voidTile.void_type = '-up-left';
    voidTile.setType(Tile.VOID);
    expect(voidTile.path()).toBe('/tiles/void-up-left.jpg');
  });

  it('has no suffix for plain tile types', () => {
    expect(new Tile(Tile.EMPTY).path()).toBe('/tiles/empty.jpg');
    expect(new Tile(Tile.REPAIR).path()).toBe('/tiles/repair.jpg');
  });
});

describe('updateVoidType', () => {
  it('leaves void_type empty when the tile has no void neighbours', () => {
    const tile = new Tile();
    // no updateVoidType call at all is the common single-void-tile case (see
    // Board#setVoid), but calling it with no neighbours set should still be inert.
    expect(tile.void_type).toBe('');
  });

  it('rotates to face an UP void neighbour and appends words for every void side, in UP/RIGHT/DOWN/LEFT scan order', () => {
    const tile = new Tile();
    // Void on the RIGHT (1) and DOWN (2) side, as Board#setVoid would report them.
    tile.updateVoidType(GameLogic.RIGHT);
    tile.updateVoidType(GameLogic.DOWN);

    // With void neighbours at RIGHT+DOWN and non-void at UP+LEFT, the algorithm looks
    // for the first `true` starting at the first `false` (UP) — i.e. RIGHT — and
    // rotates so RIGHT becomes the tile's "up". indexOf(true, no_void=0) finds RIGHT(1).
    expect(tile.direction).toBe(GameLogic.RIGHT);
    // Relative to that rotation: front (i=0) and the next side clockwise (i=1, which
    // maps back to the absolute DOWN neighbour) are void -> "-up-right"; the other two
    // relative sides (LEFT, UP absolute) are not void.
    expect(tile.void_type).toBe('-up-right');
  });

  it('picks the LAST void side via indexOf negative-wraparound when every side is a void neighbour (characterization)', () => {
    const tile = new Tile();
    tile.updateVoidType(GameLogic.UP);
    tile.updateVoidType(GameLogic.RIGHT);
    tile.updateVoidType(GameLogic.DOWN);
    tile.updateVoidType(GameLogic.LEFT);
    // no_void = indexOf(false) === -1 once every side is true, so
    // `void_neighbour.indexOf(true, -1)` searches from `length - 1` (index 3, LEFT) —
    // NOT the `=== -1` guard a few lines later, which never actually fires here. This
    // looks like it was meant to fall back to 0 but the negative fromIndex means it
    // resolves to the last index instead; locking in the real behaviour.
    expect(tile.direction).toBe(GameLogic.LEFT);
    expect(tile.void_type).toBe('-up-right-down-left');
  });

  it('does fall back to direction 0 when only the UP side is a void neighbour', () => {
    const tile = new Tile();
    tile.updateVoidType(GameLogic.UP);
    // no_void = indexOf(false) === 1 (RIGHT); indexOf(true, 1) finds nothing after
    // index 1 -> -1 -> the explicit guard resets direction to 0.
    expect(tile.direction).toBe(0);
    expect(tile.void_type).toBe('-up');
  });
});
