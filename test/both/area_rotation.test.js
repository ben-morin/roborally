import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { Board } from '../../both/board.ts';
import { Tile } from '../../both/tile.ts';
import { GameLogic } from '../../both/gamelogic.ts';

beforeEach(() => resetFakeCollections());

// Area.course.test exercises void/roller/express-roller/gear/pusher/option/repair/
// wall/laser placement, all inside a single 12x12 rally-area recipe:
//
//   setVoid(1, 1)
//   setRoller(0, 3, 'ur')            setExpressRoller(3, 3, 'uul')
//   setExpressRoller(2, 2, 'r')      setGear(1, 3, 'cw')
//   setGear(2, 3, 'ccw')             setPusher(1, 0, 'down', 'even')
//   setPusher(2, 0, 'up', 'odd')     setOption(2, 1)
//   setRepair(0, 1)                  addWall(1, 2, 'right')
//   addWall(3, 0, 'up')              addLaser(1, 2, 'd', 2)
//   addDoubleLaser(0, 1, 'r', 1)
//
// addRallyArea always uses a 12x12 footprint (`addArea(..., 12, 12)`) regardless of
// orientation, so rotating it never pushes a placement off the area's own bounds —
// unlike addStartArea (12x4), rotation is only ever exercised on rally areas in the
// real board catalog (see board_box.ts: every addStartArea call omits `orientation`).
//
// For a WxH area (`area_width` x `area_height`, both 12 here) Board#col/Board#row
// transform local (x, y) to board coordinates as:
//   0:   (x,               y)
//   90:  (H-1-y,           x)
//   180: (W-1-x,           H-1-y)
//   270: (y,               W-1-x)
// (plus the board-level x_offset/y_offset). Since W === H === 12 here, this reduces to
// (11-y, x) / (11-x, 11-y) / (y, 11-x) for 90/180/270. Each case below independently
// derives the expected board coordinate from that formula rather than re-running the
// production code, so a change to the col/row transform itself would be caught here.

function rotate(x, y, orientation) {
  const W = 12;
  const H = 12;
  switch (orientation) {
    case 0:
      return { x, y };
    case 90:
      return { x: H - 1 - y, y: x };
    case 180:
      return { x: W - 1 - x, y: H - 1 - y };
    case 270:
      return { x: y, y: W - 1 - x };
    default:
      throw new Error(`unexpected orientation ${orientation}`);
  }
}

function boardWithTestArea(orientation) {
  const board = new Board('rot', 2, 8, 12, 16);
  board.addRallyArea('test', 0, 0, orientation);
  return board;
}

describe.each([0, 90, 180, 270])('Area.course.test placed at orientation %i', (orientation) => {
  it('places the void tile at the rotated coordinate', () => {
    const board = boardWithTestArea(orientation);
    const { x, y } = rotate(1, 1, orientation);
    expect(board.getTile(x, y).type).toBe(Tile.VOID);
  });

  it('places repair and option tiles at their rotated coordinates', () => {
    const board = boardWithTestArea(orientation);
    const repair = rotate(0, 1, orientation);
    const option = rotate(2, 1, orientation);
    expect(board.getTile(repair.x, repair.y).repair).toBe(true);
    expect(board.getTile(repair.x, repair.y).type).toBe(Tile.REPAIR);
    expect(board.getTile(option.x, option.y).type).toBe(Tile.OPTION);
  });

  it('places both gear tiles, rotation sense (cw/ccw) unaffected by area orientation', () => {
    const board = boardWithTestArea(orientation);
    const cw = rotate(1, 3, orientation);
    const ccw = rotate(2, 3, orientation);
    expect(board.getTile(cw.x, cw.y).type).toBe(Tile.GEAR);
    expect(board.getTile(cw.x, cw.y).rotate).toBe(1);
    expect(board.getTile(ccw.x, ccw.y).type).toBe(Tile.GEAR);
    expect(board.getTile(ccw.x, ccw.y).rotate).toBe(-1);
  });

  it("rotates each pusher's absolute push direction by the area orientation", () => {
    const board = boardWithTestArea(orientation);
    const downPusher = rotate(1, 0, orientation);
    const upPusher = rotate(2, 0, orientation);
    // absolute_dir(direction) = (to_dir(direction) + orientation/90) % 4
    const expectedDown = (GameLogic.DOWN + orientation / 90) % 4;
    const expectedUp = (GameLogic.UP + orientation / 90) % 4;
    expect(board.getTile(downPusher.x, downPusher.y).direction).toBe(expectedDown);
    expect(board.getTile(downPusher.x, downPusher.y).pusher_type).toBe(0); // 'even'
    expect(board.getTile(upPusher.x, upPusher.y).direction).toBe(expectedUp);
    expect(board.getTile(upPusher.x, upPusher.y).pusher_type).toBe(1); // 'odd'
  });

  it('rotates addWall directions by the area orientation', () => {
    const board = boardWithTestArea(orientation);
    const wallTile = rotate(3, 0, orientation); // addWall(3, 0, 'up')
    const expectedWallDir = (GameLogic.UP + orientation / 90) % 4;
    expect(board.getTile(wallTile.x, wallTile.y).hasWall(expectedWallDir)).toBe(true);
  });

  it('places a rotated laser beam with damage and end walls at the rotated coordinates', () => {
    const board = boardWithTestArea(orientation);
    // addLaser(1, 2, 'd', 2): 2-tile beam from (1,2) heading local-down.
    const start = rotate(1, 2, orientation);
    const end = rotate(1, 3, orientation);
    expect(board.getTile(start.x, start.y).damage).toBe(1);
    expect(board.getTile(end.x, end.y).damage).toBe(1);
    const expectedDir = (GameLogic.DOWN + orientation / 90) % 4;
    const oppositeOfExpectedDir = (expectedDir + 2) % 4;
    expect(board.getTile(start.x, start.y).hasWall(oppositeOfExpectedDir)).toBe(true);
    expect(board.getTile(end.x, end.y).hasWall(expectedDir)).toBe(true);
  });
});

describe('Area rotation applied to a full catalog board', () => {
  it('oddest_sea stacks a 180°-rotated vault on top of an unrotated maelstrom (regression for addArea offset reset between calls)', async () => {
    const { BoardBox } = await import('../../both/board_box.ts');
    const board = BoardBox.getBoard(BoardBox.getBoardId('oddest_sea'));
    expect(board.height).toBe(28);
    // vault's own void(2,3) rotated 180 in a 12x12 area -> (11-2, 11-3) = (9, 8),
    // placed at y_offset 0 (addRallyArea('vault', 0, 0, 180)).
    expect(board.getTile(9, 8).type).toBe(Tile.VOID);
    // maelstrom is unrotated at y_offset 12: its void(5,5) lands at (5, 17).
    expect(board.getTile(5, 17).type).toBe(Tile.VOID);
  });

  it('around_the_world composes a 180°-rotated island with a 90°-rotated spin_zone (regression for orientation not leaking between addRallyArea calls)', async () => {
    const { BoardBox } = await import('../../both/board_box.ts');
    const board = BoardBox.getBoard(BoardBox.getBoardId('around_the_world'));
    // island's repair(0, 11) rotated 180 at y_offset 0 -> (11-0, 11-11) = (11, 0).
    expect(board.getTile(11, 0).repair).toBe(true);
    // spin_zone's repair(2, 3) rotated 90 at y_offset 12 -> col=11-3=8, row=2+12=14.
    expect(board.getTile(8, 14).repair).toBe(true);
  });
});

describe('addStartArea (never rotated in the real catalog, but orientation is still wired through)', () => {
  it('places start points and rotates their facing direction by the area orientation', () => {
    const board = new Board('start-rot', 2, 8, 12, 16);
    // Area.start.test: 4 starts at local (0,0)..(3,0), all facing 'up'. A start area is
    // 12x4, but a single row (constant y=0) stays inside any orientation's footprint
    // without touching the area's far edge, so this is safe to check the transform on
    // even though no real board rotates a start area.
    board.addStartArea('test', 0, 0, 90);
    // col(x,0) = area_height-1-0 = 3; row(x,0) = x. So (0,0)..(3,0) -> a vertical line
    // at col 3, rows 0..3.
    for (let i = 0; i < 4; i++) {
      expect(board.getTile(3, i).start).toBe(i + 1);
    }
    expect(board.startpoints).toHaveLength(4);
    const expectedDir = (GameLogic.UP + 1) % 4; // orientation 90 -> RIGHT
    for (const sp of board.startpoints) {
      expect(sp.direction).toBe(expectedDir);
    }
  });
});
