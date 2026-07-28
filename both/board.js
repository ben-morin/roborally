import { Area } from './area.js';
import { GameLogic } from './gamelogic.js';
import { Tile } from './tile.js';

const long_dir = {
  r: 'right',
  l: 'left',
  u: 'up',
  d: 'down',
  right: 'right',
  left: 'left',
  up: 'up',
  down: 'down',
};

const opp_word = {
  r: 'l',
  l: 'r',
  u: 'd',
  d: 'u',
  right: 'left',
  left: 'right',
  up: 'down',
  down: 'up',
};

function create2DArray(rows) {
  const arr = [];
  for (let i = 0; i < rows; i++) {
    arr[i] = [];
  }
  return arr;
}

function stepX(direction) {
  if (direction === 'l' || direction === 'left') {
    return -1;
  } else if (direction === 'r' || direction === 'right') {
    return 1;
  } else {
    return 0;
  }
}

function stepY(direction) {
  if (direction === 'u' || direction === 'up') {
    return -1;
  } else if (direction === 'd' || direction === 'down') {
    return 1;
  } else {
    return 0;
  }
}

function nextX(x, direction) {
  return x + stepX(direction);
}

function nextY(y, direction) {
  return y + stepY(direction);
}

function opp_dir(dir) {
  switch (typeof dir) {
    case 'number':
      return (dir + 2) % 4;
    case 'string':
      return opp_word[dir];
    case 'object':
      return { x: -dir.x, y: -dir.y };
  }
}

function toTitleCase(str) {
  return str
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

export class Board {
  constructor(name, min_player = 2, max_player = 8, width = 12, height = 16) {
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

  getTile(x, y) {
    if (!this.onBoard(x, y)) {
      console.warn(`Invalid board tile (${x},${y})`);
      return new Tile(Tile.LIMBO);
    }
    return this.tiles[y][x];
  }

  onBoard(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  canMove(x, y, direction) {
    const dir = Board.to_dir(direction);
    const tile = this.getTile(x, y);
    const step = Board.to_step(direction);
    const targetTile = this.getTile(x + step.x, y + step.y);
    const targetTileDir = opp_dir(dir);

    return !tile.hasWall(dir) && !targetTile.hasWall(targetTileDir);
  }

  addRallyArea(name, x_offset = 0, y_offset = 0, orientation = 0) {
    this.addArea(Area.course[name], x_offset, y_offset, orientation, 12, 12);
  }

  addStartArea(name, x_offset = 0, y_offset = 12, orientation = 0) {
    this.addArea(Area.start[name], x_offset, y_offset, orientation, 12, 4);
  }

  addArea(build_area, x_offset, y_offset, orientation, width, height) {
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

  addCheckpoint(x, y) {
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

  static to_dir(val) {
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
        return GameLogic[long_dir[val].toUpperCase()];
    }
  }

  static to_step(dir) {
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

  //~~~~~~~~~ methods used in area.js to construct board areas

  tile(x, y) {
    return this.tiles[this.row(x, y)][this.col(x, y)];
  }

  absolute_dir(direction) {
    return (Board.to_dir(direction) + this.orientation / 90) % 4;
  }

  col(x, y) {
    // No default case: an unrecognized orientation yields NaN, as it always has.
    let res;
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
    return res + this.x_offset;
  }

  row(x, y) {
    let res;
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
    return res + this.y_offset;
  }

  setVoid(x, y) {
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

  setRoller(x, y, route, speed = 1) {
    let last_dir = route.charAt(0);
    this.setRollerTileProp(x, y, 'straight', last_dir, speed);

    for (const cur_dir of route.slice(1)) {
      let roller_type;
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

  setExpressRoller(x, y, route) {
    this.setRoller(x, y, route, 2);
  }

  setRepair(x, y) {
    const tile = this.tile(x, y);
    tile.repair = true;
    tile.setType(Tile.REPAIR);
  }

  setOption(x, y) {
    const tile = this.tile(x, y);
    tile.repair = true;
    tile.option = true;
    tile.setType(Tile.OPTION);
  }

  setGear(x, y, gear_type) {
    const tile = this.tile(x, y);
    tile.gear_type = gear_type;
    tile.rotate = gear_type === 'cw' ? 1 : -1;
    tile.setType(Tile.GEAR);
  }

  setPusher(x, y, direction, pusher_type) {
    const dir = this.absolute_dir(direction);
    const tile = this.tile(x, y);
    tile.pusher_type = pusher_type === 'even' ? 0 : 1;
    tile.setType(Tile.PUSHER);
    tile.move = Board.to_step(dir);
    tile.direction = dir;
    tile.addWall(opp_dir(dir));
  }

  addWall(x, y, direction) {
    for (const d of direction.split('-')) {
      this.tile(x, y).addWall(this.absolute_dir(d));
    }
  }

  addDoubleLaser(startX, startY, direction, length) {
    this.addLaser(startX, startY, direction, length, 2);
  }

  addLaser(x, y, direction, length, strength = 1) {
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

  addStart(x, y, direction) {
    console.log(`Start ${x},${y},${direction}`);
    this.startpoints.push({
      x: Number(this.col(x, y)),
      y: Number(this.row(x, y)),
      direction: this.absolute_dir(direction),
    });

    this.tile(x, y).addStart(this.startpoints.length);
  }

  //~~~~~~ helper methods

  setRollerTileProp(x, y, roller_type, direction, speed) {
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
