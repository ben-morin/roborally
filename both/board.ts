import { Area } from './area.ts';
import { GameLogic } from './gamelogic.ts';
import { Tile } from './tile.ts';

/** The three shapes a direction arrives in: an index, a word or letter, or a step vector. */
export type Direction = number | keyof typeof long_dir | { x: number; y: number };

const long_dir: Record<string, 'up' | 'right' | 'down' | 'left'> = {
  r: 'right',
  l: 'left',
  u: 'up',
  d: 'down',
  right: 'right',
  left: 'left',
  up: 'up',
  down: 'down',
};

const opp_word: Record<string, string> = {
  r: 'l',
  l: 'r',
  u: 'd',
  d: 'u',
  right: 'left',
  left: 'right',
  up: 'down',
  down: 'up',
};

function create2DArray(rows: number) {
  const arr: Tile[][] = [];
  for (let i = 0; i < rows; i++) {
    arr[i] = [];
  }
  return arr;
}

function stepX(direction: string) {
  if (direction === 'l' || direction === 'left') {
    return -1;
  } else if (direction === 'r' || direction === 'right') {
    return 1;
  } else {
    return 0;
  }
}

function stepY(direction: string) {
  if (direction === 'u' || direction === 'up') {
    return -1;
  } else if (direction === 'd' || direction === 'down') {
    return 1;
  } else {
    return 0;
  }
}

function nextX(x: number, direction: string) {
  return x + stepX(direction);
}

function nextY(y: number, direction: string) {
  return y + stepY(direction);
}

// Callers here only ever pass a number; the implementation signature records the three
// shapes the body actually handles.
function opp_dir(dir: number): number;
function opp_dir(dir: Direction): Direction {
  switch (typeof dir) {
    case 'number':
      return (dir + 2) % 4;
    case 'string':
      return opp_word[dir];
    case 'object':
      return { x: -dir.x, y: -dir.y };
  }
}

function toTitleCase(str: string) {
  return str
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

export class Board {
  name: string;
  title: string;
  tiles: Tile[][];
  startpoints: { x: number; y: number; direction: number }[];
  checkpoints: { x: number; y: number; number: number }[];
  min_player: number;
  max_player: number;
  height: number;
  width: number;
  x_offset: number;
  y_offset: number;
  orientation: number;
  area_width: number;
  area_height: number;

  // Set by the recipes in board_box.ts, and shown on the board thumbnail.
  length?: 'short' | 'medium' | 'long';

  constructor(name: string, min_player = 2, max_player = 8, width = 12, height = 16) {
    this.name = name;
    this.title = toTitleCase(name);
    this.tiles = create2DArray(height);
    this.startpoints = [];
    this.checkpoints = [];
    this.min_player = min_player;
    this.max_player = max_player;
    this.height = height;
    this.width = width;

    // The area cursor `addArea` sets up before calling a recipe, and resets afterwards.
    // Initialized here to the identity placement so the `tile()`-based helpers work on a
    // bare board, not only from inside `addArea`.
    this.x_offset = 0;
    this.y_offset = 0;
    this.orientation = 0;
    this.area_width = width;
    this.area_height = height;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.tiles[y][x] = new Tile();
      }
    }
  }

  getTile(x: number, y: number) {
    if (!this.onBoard(x, y)) {
      console.warn(`Invalid board tile (${x},${y})`);
      return new Tile(Tile.LIMBO);
    }
    return this.tiles[y][x];
  }

  onBoard(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  canMove(x: number, y: number, direction: Direction) {
    // `to_dir` is undefined only for a zero step vector, which is not a move.
    const dir = Board.to_dir(direction)!;
    const tile = this.getTile(x, y);
    const step = Board.to_step(direction);
    const targetTile = this.getTile(x + step.x, y + step.y);
    const targetTileDir = opp_dir(dir);

    return !tile.hasWall(dir) && !targetTile.hasWall(targetTileDir);
  }

  addRallyArea(name: string, x_offset = 0, y_offset = 0, orientation = 0) {
    this.addArea(Area.course[name], x_offset, y_offset, orientation, 12, 12);
  }

  addStartArea(name: string, x_offset = 0, y_offset = 12, orientation = 0) {
    this.addArea(Area.start[name], x_offset, y_offset, orientation, 12, 4);
  }

  addArea(
    build_area: (this: Board) => void,
    x_offset: number,
    y_offset: number,
    orientation: number,
    width: number,
    height: number
  ) {
    this.x_offset = x_offset;
    this.y_offset = y_offset;
    this.orientation = orientation;
    this.area_height = height;
    this.area_width = width;

    build_area.call(this);

    this.x_offset = 0;
    this.y_offset = 0;
    this.orientation = 0;
  }

  addCheckpoint(x: number, y: number) {
    let cnt = this.checkpoints.length;
    if (cnt > 0) {
      const last_cp = this.checkpoints[cnt - 1];
      this.tile(last_cp.x, last_cp.y).finish = false;
    }

    cnt += 1;
    this.checkpoints.push({ x, y, number: cnt });
    this.tile(x, y).addCheckpoint(cnt);
    console.log(`Checkpoint ${cnt} located at ${x},${y}`);
  }

  // A step vector of {x: 0, y: 0} points nowhere; a number or a word always resolves.
  static to_dir(val: number | keyof typeof long_dir): number;
  static to_dir(val: Direction): number | undefined;
  static to_dir(val: Direction): number | undefined {
    switch (typeof val) {
      case 'object':
        if (val.x > 0) {
          return GameLogic.RIGHT;
        } else if (val.x < 0) {
          return GameLogic.LEFT;
        } else if (val.y > 0) {
          return GameLogic.DOWN;
        } else if (val.y < 0) {
          return GameLogic.UP;
        }
        break;
      case 'number':
        if (val < 0 || val > 3) {
          return val % 4;
        } else {
          return val;
        }
      case 'string':
        // `toUpperCase()` widens to `string`; the four words are the four GameLogic keys.
        return GameLogic[long_dir[val].toUpperCase() as 'UP' | 'RIGHT' | 'DOWN' | 'LEFT'];
    }
  }

  static to_step(dir: Direction) {
    const step = { x: 0, y: 0 };
    switch (this.to_dir(dir)) {
      case GameLogic.UP:
        step.y = -1;
        break;
      case GameLogic.RIGHT:
        step.x = 1;
        break;
      case GameLogic.DOWN:
        step.y = 1;
        break;
      case GameLogic.LEFT:
        step.x = -1;
        break;
    }
    return step;
  }

  //~~~~~~~~~ methods used in area.ts to construct board areas

  tile(x: number, y: number) {
    return this.tiles[this.row(x, y)][this.col(x, y)];
  }

  absolute_dir(direction: number | keyof typeof long_dir) {
    return (Board.to_dir(direction) + this.orientation / 90) % 4;
  }

  col(x: number, y: number) {
    // No default case: an unrecognized orientation leaves `res` unset, and the sum below is
    // NaN, as it always has been. The `!` says so rather than pretending otherwise.
    let res: number | undefined;
    switch (this.orientation) {
      case 0:
        res = x;
        break;
      case 90:
        res = this.area_height - 1 - y;
        break;
      case 180:
        res = this.area_width - 1 - x;
        break;
      case 270:
        res = y;
        break;
    }
    return res! + this.x_offset;
  }

  row(x: number, y: number) {
    // Unset for an unrecognized orientation, exactly as in `col` above.
    let res: number | undefined;
    switch (this.orientation) {
      case 0:
        res = y;
        break;
      case 90:
        res = x;
        break;
      case 180:
        res = this.area_height - 1 - y;
        break;
      case 270:
        res = this.area_width - 1 - x;
        break;
    }
    return res! + this.y_offset;
  }

  setVoid(x: number, y: number) {
    this.tile(x, y).setType(Tile.VOID);
    for (let i = 0; i <= 3; i++) {
      const step = Board.to_step(i);
      const nx = x + step.x;
      const ny = y + step.y;
      if (
        this.onBoard(this.col(nx, ny), this.row(nx, ny)) &&
        this.tile(nx, ny).type === Tile.VOID
      ) {
        this.tile(nx, ny).updateVoidType(this.absolute_dir(opp_dir(i)));
        this.tile(x, y).updateVoidType(this.absolute_dir(i));
      }
    }
  }

  setRoller(x: number, y: number, route: string, speed = 1) {
    let last_dir = route.charAt(0);
    this.setRollerTileProp(x, y, 'straight', last_dir, speed);

    for (const cur_dir of route.slice(1)) {
      let roller_type: string;
      // not the curved conveyor belt but the previous one rotates the robot
      if (last_dir !== cur_dir) {
        const rot = Board.to_dir(cur_dir) - Board.to_dir(last_dir);
        if (rot === -1 || rot === 3) {
          this.tile(x, y).rotate = -1;
          roller_type = 'ccw';
        } else {
          this.tile(x, y).rotate = 1;
          roller_type = 'cw';
        }
      } else {
        roller_type = 'straight';
      }

      x = nextX(x, last_dir);
      y = nextY(y, last_dir);
      this.setRollerTileProp(x, y, roller_type, cur_dir, speed);

      last_dir = cur_dir;
    }
  }

  setExpressRoller(x: number, y: number, route: string) {
    this.setRoller(x, y, route, 2);
  }

  setRepair(x: number, y: number) {
    const tile = this.tile(x, y);
    tile.repair = true;
    tile.setType(Tile.REPAIR);
  }

  setOption(x: number, y: number) {
    const tile = this.tile(x, y);
    tile.repair = true;
    tile.option = true;
    tile.setType(Tile.OPTION);
  }

  setGear(x: number, y: number, gear_type: 'cw' | 'ccw') {
    const tile = this.tile(x, y);
    tile.gear_type = gear_type;
    tile.rotate = gear_type === 'cw' ? 1 : -1;
    tile.setType(Tile.GEAR);
  }

  setPusher(x: number, y: number, direction: string, pusher_type: 'even' | 'odd') {
    const dir = this.absolute_dir(direction);
    const tile = this.tile(x, y);
    tile.pusher_type = pusher_type === 'even' ? 0 : 1;
    tile.setType(Tile.PUSHER);
    tile.move = Board.to_step(dir);
    tile.direction = dir;
    tile.addWall(opp_dir(dir));
  }

  addWall(x: number, y: number, direction: string) {
    for (const d of direction.split('-')) {
      this.tile(x, y).addWall(this.absolute_dir(d));
    }
  }

  addDoubleLaser(startX: number, startY: number, direction: string, length: number) {
    this.addLaser(startX, startY, direction, length, 2);
  }

  addLaser(x: number, y: number, direction: string, length: number, strength = 1) {
    const dir = this.absolute_dir(direction);

    for (let i = 1; i <= length; i++) {
      const tile = this.tile(x, y);
      tile.addLaser(dir, strength);
      if (i === 1) {
        // lasers are always between walls
        tile.addWall(opp_dir(dir));
      }
      if (i === length) {
        tile.addWall(dir);
      }

      y = nextY(y, direction);
      x = nextX(x, direction);
    }
  }

  addStart(x: number, y: number, direction: string) {
    console.log(`Start ${x},${y},${direction}`);
    this.startpoints.push({
      x: Number(this.col(x, y)),
      y: Number(this.row(x, y)),
      direction: this.absolute_dir(direction),
    });

    this.tile(x, y).addStart(this.startpoints.length);
  }

  //~~~~~~ helper methods

  setRollerTileProp(x: number, y: number, roller_type: string, direction: string, speed: number) {
    const dir = this.absolute_dir(direction);
    const tile = this.tile(x, y);
    tile.direction = dir;
    tile.move = Board.to_step(dir);
    tile.speed = speed;

    if (tile.type === Tile.ROLLER && tile.roller_type !== roller_type) {
      const t = tile.roller_type.split('-');
      t.push(roller_type);
      roller_type = t.sort().join('-');
    }

    tile.roller_type = roller_type;
    tile.setType(Tile.ROLLER);
  }
}
