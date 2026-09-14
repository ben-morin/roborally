import { Board } from './board.ts';

// A tab on board select. `devOnly` keeps the whole group off the page and out of reach of
// `selectBoard` except under `meteor run`; a single board hides itself through `Board.hidden`.
export interface BoardGroup {
  id: string;
  label: string;
  devOnly?: boolean;
  boards: readonly string[];
}

export class BoardBox {
  // The groups are the one ordered thing left, and their order is display order only: a
  // game stores its board by name, so a board can be added, moved or hidden here without
  // touching any game.
  static GROUPS: readonly BoardGroup[] = [
    {
      id: 'beginner',
      label: 'Beginner courses',
      boards: [
        'default',
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
      ],
    },
    {
      id: 'expert',
      label: 'Expert courses',
      // The course manual gives the last eight of these special rules; none are implemented.
      boards: [
        'vault_assault',
        'whirlwind_tour',
        'moving_targets',
        'lost_bearings',
        'robot_stew',
        'oddest_sea',
        'against_the_grain',
        'island_king',
        'tricksy',
        'set_to_kill',
        'factory_rejects',
        'option_world',
        'tight_collar',
        'ball_lightning',
        'flag_fry',
        'crowd_chess',
      ],
    },
    {
      id: 'custom',
      label: 'Custom courses',
      boards: ['custom_made', 'quarter_pounder'],
    },
    {
      id: 'dev',
      label: 'Dev boards',
      devOnly: true,
      boards: ['test', 'dev_test'],
    },
  ];

  static cache: Record<string, Board> = {};
  static placeholders: Record<string, Board> = {};

  // Board recipes, kept lazy on purpose: `new Board()` must not run until getBoard()
  // asks for one, so this module body never touches the imported Board binding.
  static boards: Record<string, () => Board> = {
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
    test() {
      const board = new Board('test', 1, 4, 4, 5);
      board.addRallyArea('test');
      board.addStartArea('test', 0, 4);
      board.addCheckpoint(3, 0);
      board.addCheckpoint(0, 0);
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
      board.hidden = true;
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
      const board = new Board('island_king', 5, 8);
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

  // `hasOwn`, not `in`: the recipes are a plain object, so `in` would answer for `toString` too.
  static hasBoard(name: string) {
    return Object.hasOwn(this.boards, name);
  }

  static getBoard(name: string) {
    // Every caller passes a name off a game document or a group, so an unknown one is a bug
    // rather than a miss to fall back from. `hasBoard` is the question to ask first. This
    // is the server's getter; the client renders through getBoardOrPlaceholder.
    if (!this.hasBoard(name)) throw new Error(`Unknown board: ${name}`);
    if (this.cache[name] === undefined) {
      console.log(`Load ${name} board`);
      this.cache[name] = this.boards[name]();
    }
    return this.cache[name];
  }

  // What the client draws for a name it cannot build: a 12×16 board that is one pit, hazard
  // rim outside, solid black inside. Board.tsx puts the caption over it.
  static placeholder(name: string) {
    if (this.placeholders[name] === undefined) {
      const board = new Board(name, 1, 8);
      board.title = 'Board not available';
      board.hidden = true;
      board.missing = true;
      for (let y = 0; y < board.height; y++) {
        for (let x = 0; x < board.width; x++) board.setVoid(x, y);
      }
      // The four-sided piece keeps rim corners for the diagonal floors a plus-shaped pit
      // has; a pit with no floor anywhere has none, so the inside is the solid tile.
      for (let y = 1; y < board.height - 1; y++) {
        for (let x = 1; x < board.width - 1; x++) {
          const tile = board.tile(x, y);
          tile.void_type = '-full';
          tile.direction = 0;
        }
      }
      this.placeholders[name] = board;
    }
    return this.placeholders[name];
  }

  // The client's getter: never a throw mid-render.
  static getBoardOrPlaceholder(name: string) {
    return this.hasBoard(name) ? this.getBoard(name) : this.placeholder(name);
  }

  static groupOf(name: string) {
    return this.GROUPS.find((group) => group.boards.includes(name));
  }

  // What board select renders: no dev group outside development, no hidden board, no group
  // left empty. `Meteor.isDevelopment` is read per call, not at load, so a test can flip it.
  static visibleGroups(): BoardGroup[] {
    return this.GROUPS.filter((group) => !group.devOnly || Meteor.isDevelopment)
      .map((group) => ({
        ...group,
        boards: group.boards.filter((name) => !this.getBoard(name).hidden),
      }))
      .filter((group) => group.boards.length > 0);
  }

  // What `selectBoard` accepts: exactly what board select shows, so a board that is off the
  // page cannot be reached by name either.
  static isSelectable(name: string) {
    return this.visibleGroups().some((group) => group.boards.includes(name));
  }
}
