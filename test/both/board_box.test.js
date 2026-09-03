import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeCollections } from '../setup.js';
import { BoardBox } from '../../both/board_box.ts';
import { Board } from '../../both/board.ts';

beforeEach(() => resetFakeCollections());

const EXPECTED_CHECKPOINT_COUNTS = {
  default: 3,
  quarter_pounder: 4,
  option_world: 4,
  checkmate: 2,
  bloodbath_chess: 4,
  whirlwind_tour: 3,
  oddest_sea: 4,
  // 'moving_targets' is defined in `BoardBox.boards` but is not in `BoardBox.CATALOG`
  // (see the dead-code note in the suite summary) — deliberately absent here too.
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
};

describe('BoardBox catalog', () => {
  it('builds every catalog board without throwing, with the expected checkpoint count', () => {
    for (const name of BoardBox.CATALOG) {
      const id = BoardBox.getBoardId(name);
      const board = BoardBox.getBoard(id);
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

  it('caches board instances: repeat lookups by id return the same object', () => {
    const first = BoardBox.getBoard(0);
    const second = BoardBox.getBoard(0);
    expect(second).toBe(first);
  });

  it('falls back to board 0 (default) for an out-of-range or nullish id, without touching the test-board slots', () => {
    expect(BoardBox.getBoard(-1)).toBe(BoardBox.getBoard(0));
    expect(BoardBox.getBoard(null)).toBe(BoardBox.getBoard(0));
    expect(BoardBox.getBoard(BoardBox.CATALOG.length + 50)).toBe(BoardBox.getBoard(0));
  });

  it('getBoardId round-trips catalog names, and resolves the special test/dev-test names', () => {
    expect(BoardBox.getBoardId('risky_exchange')).toBe(1);
    expect(BoardBox.getBoardId('not-a-real-board')).toBe(-1);
    expect(BoardBox.getBoardId('test-mode')).toBe(BoardBox.test_board_id);
    expect(BoardBox.getBoardId('dev-test')).toBe(BoardBox.dev_test_board_id);
  });

  it('serves the test and dev-test boards from their own cache slots, independent of the catalog', () => {
    const testBoard = BoardBox.getBoard(BoardBox.test_board_id);
    expect(testBoard).toBe(BoardBox.getTestBoard());
    expect(testBoard.name).toBe('test');

    const devTestBoard = BoardBox.getBoard(BoardBox.dev_test_board_id);
    expect(devTestBoard).toBe(BoardBox.getDevTestBoard());
    expect(devTestBoard.name).toBe('dev_test');
    // dev_test's 3 core starts (A, B, C) plus 5 filler slots
    expect(devTestBoard.startpoints).toHaveLength(8);
  });

  it('sizes long boards (two stacked 12x12 rally areas + a start area) to 12x28', () => {
    const board = BoardBox.getBoard(BoardBox.getBoardId('pilgrimage'));
    expect(board.width).toBe(12);
    expect(board.height).toBe(28);
  });
});
