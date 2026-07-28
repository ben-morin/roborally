/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS206: Consider reworking classes to avoid initClass
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
const Cls = (globalThis.BoardBox = class BoardBox {
  static initClass() {
    this.CATALOG = [
      'default',
      // beginner courses
      'risky_exchange',
      'checkmate',
      'dizzy_dash',
      'island_hop',
      'chop_shop_challenge',
      'twister',
      'bloodbath_chess',
      'around_the_world',
      'death_trap',
      'pilgrimage',
      // expert courses
      'vault_assault',
      'whirlwind_tour',
      'lost_bearings',
      'robot_stew',
      'oddest_sea',
      'against_the_grain',
      'island_king',
      // with special rules
      'tricksy', //moving_targets',
      'set_to_kill',
      'factory_rejects',
      'option_world',
      'tight_collar',
      'ball_lightning',
      'flag_fry',
      'crowd_chess',
      'custom_made',
      'quarter_pounder',
    ];

    this.BEGINNER_COURSE_CNT = 11;
    this.CUSTOM_COURSE_IDX = 26;
    this.cache = [];
    this.test_board_id = this.CATALOG.length;
    this.dev_test_board_id = this.CATALOG.length + 1;

    this.boards = {
      default() {
        const board = new Board('default', 1);
        board.length = 'short';
        board.addRallyArea('cross');
        board.addStartArea('simple');
        board.addCheckpoint(7, 3);
        board.addCheckpoint(1, 8);
        board.addCheckpoint(7, 7);
        return board;
      },
      quarter_pounder() {
        const board = new Board('quarter_pounder', 1);
        board.length = 'short';
        board.addRallyArea('quarterpounder');
        board.addStartArea('roller2');
        board.addCheckpoint(10, 1);
        board.addCheckpoint(11, 11);
        board.addCheckpoint(0, 0);
        board.addCheckpoint(0, 11);
        return board;
      },
      test3() {
        const board = new Board('test', 1, 4, 4, 5);
        board.addRallyArea('test');
        board.addStartArea('test', 0, 4);
        board.addCheckpoint(3, 0);
        board.addCheckpoint(0, 0);
        return board;
      },
      test2() {
        const board = new Board('test', 1, 4, 4, 5);
        board.addStartArea('test', 0, 4);
        board.addCheckpoint(3, 0);
        return board;
      },
      test() {
        const board = new Board('test', 1, 4, 4, 5);
        //      board.addRallyArea('test_pit')
        board.addStartArea('test', 0, 4);
        board.addCheckpoint(3, 0);
        return board;
      },
      dev_test() {
        // Empty 12x12 board with three robots (A, B, C) lined up along row 6
        // at columns 9, 10, 11. The right edge is at x=11, so A's "move 3"
        // pushes C, then B, then A off the board — exercises the chained
        // push-off-edge animation path.
        const board = new Board('dev_test', 1, 8, 12, 12);
        board.length = 'short';
        board.addStartArea('dev_test', 0, 3);
        board.addCheckpoint(0, 0);
        return board;
      },
      option_world() {
        const board = new Board('option_world', 2, 8);
        board.length = 'medium';
        board.addRallyArea('vault');
        board.addStartArea('roller');
        board.addCheckpoint(3, 5);
        board.addCheckpoint(9, 1);
        board.addCheckpoint(5, 8);
        board.addCheckpoint(2, 0);
        return board;
      },
      moving_targets() {
        const board = new Board('moving_targets', 2, 8);
        board.length = 'medium';
        board.addRallyArea('maelstrom');
        board.addStartArea('simple');
        board.addCheckpoint(1, 0);
        board.addCheckpoint(10, 11);
        board.addCheckpoint(11, 5);
        board.addCheckpoint(0, 6);
        return board;
      },
      checkmate() {
        const board = new Board('checkmate', 5, 8);
        board.length = 'short';
        board.addRallyArea('chess');
        board.addStartArea('simple');
        board.addCheckpoint(7, 2);
        board.addCheckpoint(3, 8);
        return board;
      },
      bloodbath_chess() {
        const board = new Board('bloodbath_chess', 2, 4);
        board.length = 'medium';
        board.addRallyArea('chess');
        board.addStartArea('simple');
        board.addCheckpoint(6, 5);
        board.addCheckpoint(2, 9);
        board.addCheckpoint(8, 7);
        board.addCheckpoint(3, 4);
        return board;
      },
      whirlwind_tour() {
        const board = new Board('whirlwind_tour', 5, 8);
        board.length = 'medium';
        board.addRallyArea('maelstrom');
        board.addStartArea('simple');
        board.addCheckpoint(8, 0);
        board.addCheckpoint(3, 11);
        board.addCheckpoint(11, 6);
        return board;
      },
      oddest_sea() {
        const board = new Board('oddest_sea', 5, 8, 12, 28);
        board.length = 'long';
        board.addRallyArea('vault', 0, 0, 180);
        board.addRallyArea('maelstrom', 0, 12);
        board.addStartArea('simple', 0, 24);
        board.addCheckpoint(8, 6);
        board.addCheckpoint(1, 4);
        board.addCheckpoint(5, 8);
        board.addCheckpoint(9, 2);
        return board;
      },
      dizzy_dash() {
        const board = new Board('dizzy_dash', 2, 8);
        board.length = 'short';
        board.addRallyArea('spin_zone');
        board.addStartArea('roller');
        board.addCheckpoint(5, 4);
        board.addCheckpoint(10, 11);
        board.addCheckpoint(1, 6);
        return board;
      },
      twister() {
        const board = new Board('twister', 5, 8);
        board.length = 'medium';
        board.addRallyArea('spin_zone');
        board.addStartArea('roller');
        board.addCheckpoint(2, 9);
        board.addCheckpoint(3, 2);
        board.addCheckpoint(9, 2);
        board.addCheckpoint(8, 9);
        return board;
      },
      island_hop() {
        const board = new Board('island_hop', 2, 8);
        board.length = 'medium';
        board.addRallyArea('island');
        board.addStartArea('simple');
        board.addCheckpoint(6, 1);
        board.addCheckpoint(1, 6);
        board.addCheckpoint(11, 4);
        return board;
      },
      death_trap() {
        const board = new Board('death_trap', 2, 4);
        board.length = 'short';
        board.addRallyArea('island');
        board.addStartArea('simple');
        board.addCheckpoint(7, 7);
        board.addCheckpoint(0, 4);
        board.addCheckpoint(6, 5);
        return board;
      },
      around_the_world() {
        const board = new Board('around_the_world', 5, 8, 12, 28);
        board.length = 'long';
        board.addRallyArea('island', 0, 0, 180);
        board.addRallyArea('spin_zone', 0, 12, 90);
        board.addStartArea('simple', 0, 24);
        board.addCheckpoint(9, 12);
        board.addCheckpoint(6, 1);
        board.addCheckpoint(5, 22);
        return board;
      },
      island_king() {
        const board = new Board('island_king', 2, 8);
        board.length = 'short';
        board.addRallyArea('island', 0, 0, 180);
        board.addStartArea('simple');
        board.addCheckpoint(5, 4);
        board.addCheckpoint(7, 7);
        board.addCheckpoint(5, 6);
        return board;
      },
      risky_exchange() {
        const board = new Board('risky_exchange', 2, 8);
        board.length = 'medium';
        board.addRallyArea('exchange');
        board.addStartArea('roller');
        board.addCheckpoint(7, 1);
        board.addCheckpoint(9, 7);
        board.addCheckpoint(1, 4);
        return board;
      },
      chop_shop_challenge() {
        const board = new Board('chop_shop_challenge', 2, 4);
        board.length = 'medium';
        board.addRallyArea('chop_shop', 0, 0, 180);
        board.addStartArea('simple');
        board.addCheckpoint(4, 9);
        board.addCheckpoint(9, 11);
        board.addCheckpoint(1, 10);
        board.addCheckpoint(11, 7);
        return board;
      },
      pilgrimage() {
        const board = new Board('pilgrimage', 2, 8, 12, 28);
        board.length = 'long';
        board.addRallyArea('cross');
        board.addRallyArea('exchange', 0, 12, 180);
        board.addStartArea('simple', 0, 24);
        board.addCheckpoint(4, 8);
        board.addCheckpoint(9, 19);
        board.addCheckpoint(2, 14);
        return board;
      },
      crowd_chess() {
        const board = new Board('crowd_chess', 8, 12);
        board.length = 'short';
        board.addRallyArea('crowd_chess');
        board.addStartArea('crowd');
        board.addCheckpoint(8, 3);
        board.addCheckpoint(3, 8);
        return board;
      },
      robot_stew() {
        const board = new Board('robot_stew', 2, 4);
        board.length = 'medium';
        board.addRallyArea('chop_shop');
        board.addStartArea('roller');
        board.addCheckpoint(0, 4);
        board.addCheckpoint(9, 7);
        board.addCheckpoint(2, 10);
        return board;
      },
      vault_assault() {
        const board = new Board('vault_assault', 2, 4);
        board.length = 'short';
        board.addRallyArea('vault', 0, 0, 270);
        board.addStartArea('roller');
        board.addCheckpoint(6, 3);
        board.addCheckpoint(4, 11);
        board.addCheckpoint(8, 5);
        return board;
      },
      lost_bearings() {
        const board = new Board('lost_bearings', 2, 4);
        board.length = 'medium';
        board.addRallyArea('cross', 0, 0, 180);
        board.addStartArea('simple');
        board.addCheckpoint(1, 2);
        board.addCheckpoint(10, 9);
        board.addCheckpoint(2, 8);
        return board;
      },
      against_the_grain() {
        const board = new Board('against_the_grain', 2, 4, 12, 28);
        board.length = 'medium';
        board.addRallyArea('chop_shop');
        board.addRallyArea('chess', 0, 12, 90);
        board.addStartArea('simple', 0, 24);
        board.addCheckpoint(10, 9);
        board.addCheckpoint(3, 3);
        board.addCheckpoint(5, 17);
        return board;
      },
      tricksy() {
        const board = new Board('tricksy', 2, 4);
        board.length = 'long';
        board.addRallyArea('cross');
        board.addStartArea('roller');
        board.addCheckpoint(9, 1);
        board.addCheckpoint(0, 1);
        board.addCheckpoint(8, 11);
        board.addCheckpoint(3, 7);
        return board;
      },
      set_to_kill() {
        const board = new Board('set_to_kill', 5, 8);
        board.length = 'medium';
        board.addRallyArea('exchange', 0, 0, 180);
        board.addStartArea('roller');
        board.addCheckpoint(5, 0);
        board.addCheckpoint(2, 11);
        board.addCheckpoint(10, 9);
        board.addCheckpoint(2, 4);
        return board;
      },
      factory_rejects() {
        const board = new Board('factory_rejects', 5, 8);
        board.length = 'short';
        board.addRallyArea('chop_shop', 0, 0, 180);
        board.addStartArea('roller');
        board.addCheckpoint(7, 1);
        board.addCheckpoint(4, 11);
        board.addCheckpoint(2, 4);
        return board;
      },
      tight_collar() {
        const board = new Board('tight_collar', 2, 8, 12, 28);
        board.length = 'medium';
        board.addRallyArea('cross', 0, 0, 180);
        board.addRallyArea('chop_shop', 0, 12, 90);
        board.addStartArea('simple', 0, 24);
        board.addCheckpoint(4, 2);
        board.addCheckpoint(9, 19);
        return board;
      },
      ball_lightning() {
        const board = new Board('ball_lightning', 2, 8);
        board.length = 'short';
        board.addRallyArea('spin_zone', 0, 0, 90);
        board.addStartArea('simple');
        board.addCheckpoint(7, 5);
        board.addCheckpoint(2, 2);
        board.addCheckpoint(5, 9);
        board.addCheckpoint(10, 0);
        return board;
      },
      flag_fry() {
        const board = new Board('flag_fry', 2, 8);
        board.length = 'short';
        board.addRallyArea('cross', 0, 0, 180);
        board.addStartArea('simple');
        board.addCheckpoint(3, 3);
        board.addCheckpoint(9, 3);
        board.addCheckpoint(3, 10);
        return board;
      },
      custom_made() {
        const board = new Board('custom_made', 4, 8, 12, 28);
        board.length = 'long';
        board.addRallyArea('canner_row', 0, 0, 0);
        board.addStartArea('crowd', 0, 12, 180);
        board.addRallyArea('vault', 0, 16, 90);

        board.addCheckpoint(5, 9);
        board.addCheckpoint(9, 22);
        board.addCheckpoint(3, 4);
        board.addCheckpoint(3, 24);
        return board;
      },
    };
  }

  static getBoard(boardId) {
    if (boardId == null || boardId < 0 || boardId >= this.CATALOG.length) {
      if (boardId === this.test_board_id) {
        return this.getTestBoard();
      } else if (boardId === this.dev_test_board_id) {
        return this.getDevTestBoard();
      } else {
        boardId = 0;
      }
    }
    if (this.cache[boardId] == null) {
      const board_name = this.CATALOG[boardId];
      console.log(`Load ${board_name} board`);
      this.cache[boardId] = this.boards[board_name]();
    }

    return this.cache[boardId];
  }

  static getBoardId(name) {
    if (name === 'test-mode') {
      return this.test_board_id;
    } else if (name === 'dev-test') {
      return this.dev_test_board_id;
    } else {
      return this.CATALOG.indexOf(name);
    }
  }

  static getTestBoard() {
    if (this.cache[this.test_board_id] == null) {
      this.cache[this.test_board_id] = this.boards.test();
    }
    return this.cache[this.test_board_id];
  }

  static getDevTestBoard() {
    if (this.cache[this.dev_test_board_id] == null) {
      this.cache[this.dev_test_board_id] = this.boards.dev_test();
    }
    return this.cache[this.dev_test_board_id];
  }
});
Cls.initClass();
