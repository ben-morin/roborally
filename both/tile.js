/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS206: Consider reworking classes to avoid initClass
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */

import { GameLogic } from './gamelogic.js';

let to_word = undefined;
let dir_words = undefined;

export class Tile {
  static initClass() {
    this.EMPTY = 'empty';
    this.VOID = 'void';
    this.ROLLER = 'roller';
    this.PUSHER = 'pusher';
    this.GEAR = 'gear';
    this.REPAIR = 'repair';
    this.OPTION = 'option';
    this.LIMBO = 'limbo';

    to_word = (dir) => dir_words[dir];

    dir_words = ['up', 'right', 'down', 'left'];
    // off the board
  }

  constructor(tile_type = Tile.EMPTY) {
    this.type = tile_type;
    this.wall = false;
    this.void_neighbour = [false, false, false, false];
    this.items = [];
    this.damage = 0;
    this.rotate = 0;
    this.move = { x: 0, y: 0 };
    this.direction = GameLogic.UP;
    this.roller_type = '';
    this.void_type = '';
  }

  hasWall(direction) {
    return this.wall && this.wall[direction];
  }

  setType(type) {
    this.type = type;
    let msg;
    return (this.description = (() => {
      switch (type) {
        case Tile.ROLLER:
          if (this.speed === 2) {
            return `This is an express converyor belt. \
You will move 2 spaces in the direction of the arrow \
when ending here after a card has been played.`;
          } else {
            return `This is a converyor belt. \
You will move 1 space in the direction of the arrow \
when ending here after a card has been played.`;
          }
        case Tile.VOID:
          return "Don't fall in this giant hole in the ground or you'll die.";
        case Tile.REPAIR:
          return 'If you end your hand on a repair site, one damage will be repaired.';
        case Tile.OPTION:
          return 'If you end your hand on an option site, you draw one option card.';
        case Tile.GEAR:
          msg = 'This gear will turn you ';
          msg += this.gear_type === 'cw' ? 'right' : 'left';
          return (msg += ' when ending here after a card has been played.');
        case Tile.PUSHER:
          msg = 'This pusher will push you 1 space away from it, but only after card ';
          return (msg += this.pusher_type === 0 ? '2 or 4' : '1, 3 or 5');
      }
    })());
  }

  path() {
    let p = `/tiles/${this.type}`;
    p += (() => {
      switch (this.type) {
        case 'gear':
          return `-${this.gear_type}`;
        case 'pusher':
          if (this.pusher_type === 0) {
            return '-even';
          } else {
            return '-odd';
          }
        case 'roller':
          if (this.speed === 2) {
            return `-express-${this.roller_type}`;
          } else {
            return `-${this.roller_type}`;
          }
        case 'void':
          return this.void_type;
        default:
          return '';
      }
    })();
    p += '.jpg';
    return p;
  }

  addWall(direction) {
    if (this.wall) {
      this.wall[direction] = true;
    } else {
      this.wall = {};
      this.wall[direction] = true;
    }

    return this.addItem('wall', direction);
  }

  addCheckpoint(number) {
    this.checkpoint = number;
    this.finish = true;
    return (this.repair = true);
  }

  addStart(number) {
    return (this.start = number);
  }

  addLaser(direction, strength) {
    const laser_type = (() => {
      switch (strength) {
        case 3:
          return 'triplelaser';
        case 2:
          return 'doublelaser';
        default:
          return 'laser';
      }
    })();
    this.damage = strength;
    return this.addItem(laser_type, direction);
  }

  addItem(type, direction) {
    // the items are inside of the tile span so the
    // direction has to be relative to the tile orientation
    return this.items.push(new Item(type, direction - this.direction));
  }

  updateVoidType(void_dir) {
    this.void_neighbour[void_dir] = true;

    // to figure out void type rotate such that
    //  - there is an UP void neighbour (if there is at least one void neighbour)
    //  - there is a LEFT non-void neighbour (if there is at least one non-void neighbour)
    const no_void = this.void_neighbour.indexOf(false);
    this.direction = this.void_neighbour.indexOf(true, no_void);
    if (this.direction === -1) {
      this.direction = 0;
    }
    this.void_type = '';
    return (() => {
      const result = [];
      for (let i = 0; i <= 3; i++) {
        if (this.void_neighbour[(i + this.direction) % 4]) {
          result.push((this.void_type += '-' + to_word(i)));
        } else {
          result.push(undefined);
        }
      }
      return result;
    })();
  }
}
Tile.initClass();

class Item {
  constructor(type, direction) {
    this.direction = direction;
    this.path = '/tiles/' + type + '.png';
    this.description = (() => {
      switch (type) {
        case 'wall':
          return "Even awesome robots can't pass through these massive walls.";
        case 'laser':
          return 'This is a laser! It hurts and you will gain one damage.';
        case 'doublelaser':
          return 'This is a double laser!! It hurts a lot and you will gain two damages.';
        case 'triplelaser':
          return 'This is a triple laser!!! It hurts like hell and you will gain three damages.';
        default:
          return false;
      }
    })();
  }
}
