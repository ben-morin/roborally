import { GameLogic } from './gamelogic.js';

const dir_words = ['up', 'right', 'down', 'left'];

const to_word = (dir) => dir_words[dir];

export class Tile {
  static EMPTY = 'empty';
  static VOID = 'void';
  static ROLLER = 'roller';
  static PUSHER = 'pusher';
  static GEAR = 'gear';
  static REPAIR = 'repair';
  static OPTION = 'option';
  static LIMBO = 'limbo'; // off the board

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

    // Types with no case here (EMPTY, LIMBO) deliberately leave description undefined.
    let description;
    switch (type) {
      case Tile.ROLLER:
        description =
          this.speed === 2
            ? `This is an express converyor belt. \
You will move 2 spaces in the direction of the arrow \
when ending here after a card has been played.`
            : `This is a converyor belt. \
You will move 1 space in the direction of the arrow \
when ending here after a card has been played.`;
        break;
      case Tile.VOID:
        description = "Don't fall in this giant hole in the ground or you'll die.";
        break;
      case Tile.REPAIR:
        description = 'If you end your hand on a repair site, one damage will be repaired.';
        break;
      case Tile.OPTION:
        description = 'If you end your hand on an option site, you draw one option card.';
        break;
      case Tile.GEAR:
        description = `This gear will turn you ${
          this.gear_type === 'cw' ? 'right' : 'left'
        } when ending here after a card has been played.`;
        break;
      case Tile.PUSHER:
        description = `This pusher will push you 1 space away from it, but only after card ${
          this.pusher_type === 0 ? '2 or 4' : '1, 3 or 5'
        }`;
        break;
    }
    this.description = description;
  }

  path() {
    let suffix;
    switch (this.type) {
      case Tile.GEAR:
        suffix = `-${this.gear_type}`;
        break;
      case Tile.PUSHER:
        suffix = this.pusher_type === 0 ? '-even' : '-odd';
        break;
      case Tile.ROLLER:
        suffix = this.speed === 2 ? `-express-${this.roller_type}` : `-${this.roller_type}`;
        break;
      case Tile.VOID:
        suffix = this.void_type;
        break;
      default:
        suffix = '';
    }
    return `/tiles/${this.type}${suffix}.jpg`;
  }

  addWall(direction) {
    if (!this.wall) {
      this.wall = {};
    }
    this.wall[direction] = true;

    this.addItem('wall', direction);
  }

  addCheckpoint(number) {
    this.checkpoint = number;
    this.finish = true;
    this.repair = true;
  }

  addStart(number) {
    this.start = number;
  }

  addLaser(direction, strength) {
    let laser_type;
    switch (strength) {
      case 3:
        laser_type = 'triplelaser';
        break;
      case 2:
        laser_type = 'doublelaser';
        break;
      default:
        laser_type = 'laser';
    }
    this.damage = strength;
    this.addItem(laser_type, direction);
  }

  addItem(type, direction) {
    // the items are inside of the tile span so the
    // direction has to be relative to the tile orientation
    this.items.push(new Item(type, direction - this.direction));
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
    for (let i = 0; i <= 3; i++) {
      if (this.void_neighbour[(i + this.direction) % 4]) {
        this.void_type += `-${to_word(i)}`;
      }
    }
  }
}

class Item {
  constructor(type, direction) {
    this.direction = direction;
    this.path = `/tiles/${type}.png`;

    // Unrecognized item types deliberately get `false`, not a description.
    let description;
    switch (type) {
      case 'wall':
        description = "Even awesome robots can't pass through these massive walls.";
        break;
      case 'laser':
        description = 'This is a laser! It hurts and you will gain one damage.';
        break;
      case 'doublelaser':
        description = 'This is a double laser!! It hurts a lot and you will gain two damages.';
        break;
      case 'triplelaser':
        description =
          'This is a triple laser!!! It hurts like hell and you will gain three damages.';
        break;
      default:
        description = false;
    }
    this.description = description;
  }
}
