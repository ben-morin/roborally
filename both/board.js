/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS202: Simplify dynamic range loops
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS206: Consider reworking classes to avoid initClass
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */

(function () {
  let create2DArray = undefined;
  let stepX = undefined;
  let stepY = undefined;
  let nextX = undefined;
  let nextY = undefined;
  let to_dir = undefined;
  let to_step = undefined;
  let opp_dir = undefined;
  let toTitleCase = undefined;
  let long_dir = undefined;
  let opp_word = undefined;
  const Cls = (globalThis.Board = class Board {
    static initClass() {
      create2DArray = function (rows) {
        const arr = [];
        for (
          let i = 0, end = rows - 1, asc = 0 <= end;
          asc ? i <= end : i >= end;
          asc ? i++ : i--
        ) {
          arr[i] = [];
        }
        return arr;
      };

      stepX = function (direction) {
        if (direction === 'l' || direction === 'left') {
          return -1;
        } else if (direction === 'r' || direction === 'right') {
          return 1;
        } else {
          return 0;
        }
      };

      stepY = function (direction) {
        if (direction === 'u' || direction === 'up') {
          return -1;
        } else if (direction === 'd' || direction === 'down') {
          return 1;
        } else {
          return 0;
        }
      };

      nextX = (x, direction) => x + stepX(direction);

      nextY = (y, direction) => y + stepY(direction);

      to_dir = (val) => Board.to_dir(val);

      to_step = (dir) => Board.to_step(dir);

      opp_dir = function (dir) {
        switch (typeof dir) {
          case 'number':
            return (dir + 2) % 4;
          case 'string':
            return opp_word[dir];
          case 'object':
            return { x: -dir.x, y: -dir.y };
        }
      };

      toTitleCase = (str) =>
        str
          .replace(/_/g, ' ')
          .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

      long_dir = {
        r: 'right',
        l: 'left',
        u: 'up',
        d: 'down',
        right: 'right',
        left: 'left',
        up: 'up',
        down: 'down',
      };

      opp_word = {
        r: 'l',
        l: 'r',
        u: 'd',
        d: 'u',
        right: 'left',
        left: 'right',
        up: 'down',
        down: 'up',
      };
    }
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

      for (
        let y = 0, end = this.height - 1, asc = 0 <= end;
        asc ? y <= end : y >= end;
        asc ? y++ : y--
      ) {
        for (
          let x = 0, end1 = this.width - 1, asc1 = 0 <= end1;
          asc1 ? x <= end1 : x >= end1;
          asc1 ? x++ : x--
        ) {
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
      const dir = to_dir(direction);
      const tile = this.getTile(x, y);
      const step = to_step(direction);
      const targetTile = this.getTile(x + step.x, y + step.y);
      const targetTileDir = opp_dir(dir);

      return !tile.hasWall(dir) && !targetTile.hasWall(targetTileDir);
    }

    addRallyArea(name, x_offset = 0, y_offset = 0, orientation = 0) {
      return this.addArea(Area.course[name], x_offset, y_offset, orientation, 12, 12);
    }

    addStartArea(name, x_offset = 0, y_offset = 12, orientation = 0) {
      return this.addArea(Area.start[name], x_offset, y_offset, orientation, 12, 4);
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
      return (this.orientation = 0);
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
      return console.log(`Checkpoint ${cnt} located at ${x},${y}`);
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
      return (to_dir(direction) + this.orientation / 90) % 4;
    }

    col(x, y) {
      const res = (() => {
        switch (this.orientation) {
          case 0:
            return x;
          case 90:
            return this.area_height - 1 - y;
          case 180:
            return this.area_width - 1 - x;
          case 270:
            return y;
        }
      })();
      return res + this.x_offset;
    }

    row(x, y) {
      const res = (() => {
        switch (this.orientation) {
          case 0:
            return y;
          case 90:
            return x;
          case 180:
            return this.area_height - 1 - y;
          case 270:
            return this.area_width - 1 - x;
        }
      })();
      return res + this.y_offset;
    }

    setVoid(x, y) {
      this.tile(x, y).setType(Tile.VOID);
      return (() => {
        const result = [];
        for (let i = 0; i <= 3; i++) {
          const step = to_step(i);
          const nx = x + step.x;
          const ny = y + step.y;
          if (
            this.onBoard(this.col(nx, ny), this.row(nx, ny)) &&
            this.tile(nx, ny).type === Tile.VOID
          ) {
            this.tile(nx, ny).updateVoidType(this.absolute_dir(opp_dir(i)));
            result.push(this.tile(x, y).updateVoidType(this.absolute_dir(i)));
          } else {
            result.push(undefined);
          }
        }
        return result;
      })();
    }

    setRoller(x, y, route, speed = 1) {
      let cur_dir = route.charAt(0);
      let roller_type = 'straight';
      this.setRollerTileProp(x, y, roller_type, cur_dir, speed);

      let last_dir = cur_dir;
      return (() => {
        const result = [];
        for (cur_dir of Array.from(route.slice(1))) {
          // not the curved conveyor belt but the previous one rotates the robot
          if (last_dir !== cur_dir) {
            const rot = to_dir(cur_dir) - to_dir(last_dir);
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

          result.push((last_dir = cur_dir));
        }
        return result;
      })();
    }

    setExpressRoller(x, y, route) {
      return this.setRoller(x, y, route, 2);
    }

    setRepair(x, y) {
      this.tile(x, y).repair = true;
      return this.tile(x, y).setType(Tile.REPAIR);
    }

    setOption(x, y) {
      this.tile(x, y).repair;
      this.tile(x, y).repair = true;
      this.tile(x, y).option = true;
      return this.tile(x, y).setType(Tile.OPTION);
    }

    setGear(x, y, gear_type) {
      this.tile(x, y).gear_type = gear_type;
      if (gear_type === 'cw') {
        this.tile(x, y).rotate = 1;
      } else {
        this.tile(x, y).rotate = -1;
      }
      return this.tile(x, y).setType(Tile.GEAR);
    }

    setPusher(x, y, direction, pusher_type) {
      const dir = this.absolute_dir(direction);
      if (pusher_type === 'even') {
        this.tile(x, y).pusher_type = 0;
      } else {
        this.tile(x, y).pusher_type = 1;
      }
      this.tile(x, y).setType(Tile.PUSHER);
      this.tile(x, y).move = to_step(dir);
      this.tile(x, y).direction = dir;
      return this.tile(x, y).addWall(opp_dir(dir));
    }

    addWall(x, y, direction) {
      return Array.from(direction.split('-')).map((d) =>
        this.tile(x, y).addWall(this.absolute_dir(d))
      );
    }

    addDoubleLaser(startX, startY, direction, length) {
      return this.addLaser(startX, startY, direction, length, 2);
    }

    addLaser(x, y, direction, length, strength = 1) {
      const dir = this.absolute_dir(direction);

      return (() => {
        const result = [];
        for (let i = 1, end = length, asc = 1 <= end; asc ? i <= end : i >= end; asc ? i++ : i--) {
          this.tile(x, y).addLaser(dir, strength);
          if (i === 1) {
            // lasers are always between walls
            this.tile(x, y).addWall(opp_dir(dir));
          }
          if (i === length) {
            this.tile(x, y).addWall(dir);
          }

          y = nextY(y, direction);
          result.push((x = nextX(x, direction)));
        }
        return result;
      })();
    }

    addStart(x, y, direction) {
      console.log(`Start ${x},${y},${direction}`);
      this.startpoints.push({
        x: Number(this.col(x, y)),
        y: Number(this.row(x, y)),
        direction: this.absolute_dir(direction),
      });

      return this.tile(x, y).addStart(this.startpoints.length);
    }

    //~~~~~~ helper methods

    setRollerTileProp(x, y, roller_type, direction, speed) {
      const dir = this.absolute_dir(direction);
      this.tile(x, y).direction = dir;
      this.tile(x, y).move = to_step(dir);
      this.tile(x, y).speed = speed;

      if (this.tile(x, y).type === Tile.ROLLER && this.tile(x, y).roller_type !== roller_type) {
        const t = this.tile(x, y).roller_type.split('-');
        t.push(roller_type);
        roller_type = t.sort().join('-');
      }

      this.tile(x, y).roller_type = roller_type;
      return this.tile(x, y).setType(Tile.ROLLER);
    }
  });
  Cls.initClass();
  return Cls;
})();
