import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { BoardBox } from '../../both/board_box.ts';
import { Board } from '../../both/board.ts';
import { Tile } from '../../both/tile.ts';

beforeEach(() => resetFakeCollections());

const EXPECTED_CHECKPOINT_COUNTS = {
  default: 3,
  quarter_pounder: 4,
  option_world: 4,
  checkmate: 2,
  bloodbath_chess: 4,
  whirlwind_tour: 3,
  oddest_sea: 4,
  moving_targets: 4,
  dizzy_dash: 3,
  twister: 4,
  island_hop: 3,
  death_trap: 3,
  around_the_world: 3,
  island_king: 3,
  risky_exchange: 3,
  chop_shop_challenge: 4,
  pilgrimage: 3,
  crowd_chess: 2,
  robot_stew: 3,
  vault_assault: 3,
  lost_bearings: 3,
  against_the_grain: 3,
  tricksy: 4,
  set_to_kill: 4,
  factory_rejects: 3,
  tight_collar: 2,
  ball_lightning: 4,
  flag_fry: 3,
  custom_made: 4,
  test: 2,
  dev_test: 1,
};

const groupNames = () => BoardBox.GROUPS.flatMap((group) => group.boards);

describe('BoardBox groups', () => {
  // The guard the groups exist for: a recipe has to be placed, once, under a real name, so
  // a board can be added, moved or hidden without a game's stored position ever changing.
  it('name only recipes that exist', () => {
    for (const name of groupNames()) {
      expect(Object.hasOwn(BoardBox.boards, name), `group entry "${name}"`).toBe(true);
    }
  });

  it('place every recipe in exactly one group', () => {
    const names = groupNames();
    expect([...names].sort()).toEqual(Object.keys(BoardBox.boards).sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it('show the dev group in development, no hidden board and no empty group', () => {
    const visible = BoardBox.visibleGroups();
    expect(visible.map((group) => group.id)).toEqual(['beginner', 'expert', 'custom', 'dev']);
    for (const group of visible) {
      expect(group.boards.length, group.id).toBeGreaterThan(0);
      for (const name of group.boards) {
        expect(BoardBox.getBoard(name).hidden, `"${name}" in ${group.id}`).toBe(false);
      }
    }
    // Hidden is not gone: the group still owns the board.
    expect(BoardBox.groupOf('moving_targets')?.id).toBe('expert');
    expect(BoardBox.groupOf('dev_test')?.devOnly).toBe(true);
    expect(BoardBox.groupOf('not-a-real-board')).toBeUndefined();
  });

  it('drop the dev group outside development', () => {
    Meteor.isDevelopment = false;
    try {
      const visible = BoardBox.visibleGroups();
      expect(visible.map((group) => group.id)).toEqual(['beginner', 'expert', 'custom']);
    } finally {
      Meteor.isDevelopment = true;
    }
  });

  it('let selectBoard pick exactly what board select shows', () => {
    expect(BoardBox.isSelectable('default')).toBe(true);
    expect(BoardBox.isSelectable('dev_test')).toBe(true);
    // Hidden boards and unknown names are never selectable.
    expect(BoardBox.isSelectable('moving_targets')).toBe(false);
    expect(BoardBox.isSelectable('not-a-real-board')).toBe(false);
    Meteor.isDevelopment = false;
    try {
      expect(BoardBox.isSelectable('dev_test')).toBe(false);
      expect(BoardBox.isSelectable('default')).toBe(true);
    } finally {
      Meteor.isDevelopment = true;
    }
  });
});

describe('BoardBox catalog', () => {
  it('builds every recipe without throwing, with the expected checkpoint count', () => {
    for (const name of groupNames()) {
      const board = BoardBox.boards[name]();
      expect(board, `board "${name}"`).toBeInstanceOf(Board);
      expect(board.checkpoints, `checkpoints for "${name}"`).toHaveLength(
        EXPECTED_CHECKPOINT_COUNTS[name]
      );
      // every checkpoint (and the tile it sits on) must resolve on-board
      for (const cp of board.checkpoints) {
        expect(board.onBoard(cp.x, cp.y), `checkpoint ${cp.number} of "${name}"`).toBe(true);
      }
      // every start point must resolve on-board and within [min_player, max_player]
      expect(board.startpoints.length).toBeGreaterThanOrEqual(board.max_player);
      for (const sp of board.startpoints) {
        expect(board.onBoard(sp.x, sp.y), `start point in "${name}"`).toBe(true);
      }
    }
  });

  it('caches board instances: repeat lookups by name return the same object', () => {
    expect(BoardBox.getBoard('default')).toBe(BoardBox.getBoard('default'));
  });

  it('throws on a name it does not have; hasBoard is the question to ask first', () => {
    expect(BoardBox.hasBoard('not-a-real-board')).toBe(false);
    expect(() => BoardBox.getBoard('not-a-real-board')).toThrow('Unknown board: not-a-real-board');
    // The recipes are a plain object, so `in` would say yes here; `hasOwn` does not.
    expect(BoardBox.hasBoard('toString')).toBe(false);
  });

  it('serves the dev boards by name like any other', () => {
    expect(BoardBox.hasBoard('test')).toBe(true);
    expect(BoardBox.groupOf('test')?.devOnly).toBe(true);
    const devTestBoard = BoardBox.getBoard('dev_test');
    expect(devTestBoard.name).toBe('dev_test');
    // dev_test's 3 core starts (A, B, C) plus 5 filler slots
    expect(devTestBoard.startpoints).toHaveLength(8);
  });

  it('sizes long boards (two stacked 12x12 rally areas + a start area) to 12x28', () => {
    const board = BoardBox.getBoard('pilgrimage');
    expect(board.width).toBe(12);
    expect(board.height).toBe(28);
  });
});

// What the client draws for a name it cannot build. The server never asks for one.
describe('BoardBox placeholder', () => {
  const board = () => BoardBox.placeholder('gone_board');
  const path = (x, y) => board().tile(x, y).path();

  it('is a hidden, missing 12x16 board that is one pit, with no checkpoints', () => {
    expect(board()).toBeInstanceOf(Board);
    expect(board()).toMatchObject({
      name: 'gone_board',
      title: 'Board not available',
      hidden: true,
      missing: true,
      width: 12,
      height: 16,
    });
    expect(board().checkpoints).toEqual([]);
    for (const tile of board().tiles.flat()) expect(tile.type).toBe(Tile.VOID);
  });

  it('draws the rim from the two- and three-sided pieces and the inside from the solid one', () => {
    expect(path(0, 0)).toBe('/tiles/void-up-right.jpg');
    expect(path(11, 0)).toBe('/tiles/void-up-right.jpg');
    expect(path(11, 15)).toBe('/tiles/void-up-right.jpg');
    expect(path(0, 15)).toBe('/tiles/void-up-right.jpg');
    expect(path(5, 0)).toBe('/tiles/void-up-right-down.jpg');
    expect(path(11, 7)).toBe('/tiles/void-up-right-down.jpg');
    expect(path(5, 15)).toBe('/tiles/void-up-right-down.jpg');
    expect(path(0, 7)).toBe('/tiles/void-up-right-down.jpg');
    // The four corners face outward: each is rotated a different way.
    expect(
      new Set([0, 11].flatMap((x) => [0, 15].map((y) => board().tile(x, y).direction))).size
    ).toBe(4);
    const inside = board()
      .tiles.flat()
      .filter((tile) => tile.path() === '/tiles/void-full.jpg');
    expect(inside).toHaveLength(10 * 14);
    // Every image the placeholder names is a real file, the new one included.
    for (const file of new Set(
      board()
        .tiles.flat()
        .map((tile) => tile.path())
    )) {
      expect(existsSync(`public${file}`), file).toBe(true);
    }
  });

  it('leaves the four-sided piece to real boards: the cross on default still has one', () => {
    const paths = BoardBox.getBoard('default')
      .tiles.flat()
      .map((tile) => tile.path());
    expect(paths).toContain('/tiles/void-up-right-down-left.jpg');
    expect(paths).not.toContain('/tiles/void-full.jpg');
  });

  it('is cached per name, and getBoardOrPlaceholder hands out the real board when there is one', () => {
    expect(BoardBox.placeholder('gone_board')).toBe(BoardBox.placeholder('gone_board'));
    expect(BoardBox.getBoardOrPlaceholder('default')).toBe(BoardBox.getBoard('default'));
    expect(BoardBox.getBoardOrPlaceholder('gone_board')).toBe(BoardBox.placeholder('gone_board'));
    expect(BoardBox.hasBoard('gone_board')).toBe(false);
  });
});
