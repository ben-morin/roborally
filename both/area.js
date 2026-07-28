/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS206: Consider reworking classes to avoid initClass
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
export class Area {
  static initClass() {
    this.start = {
      simple() {
        this.addWall(2, 0, 'up');
        this.addWall(4, 0, 'up');
        this.addWall(7, 0, 'up');
        this.addWall(9, 0, 'up');
        this.addWall(1, 2, 'left');
        this.addWall(3, 2, 'left');
        this.addWall(5, 2, 'left');
        this.addWall(6, 2, 'left');
        this.addWall(8, 2, 'left');
        this.addWall(10, 2, 'left');
        this.addWall(11, 2, 'left');
        this.addWall(2, 3, 'down');
        this.addWall(4, 3, 'down');
        this.addWall(7, 3, 'down');
        this.addWall(9, 3, 'down');

        this.addStart(5, 2, 'up');
        this.addStart(6, 2, 'up');
        this.addStart(3, 2, 'up');
        this.addStart(8, 2, 'up');
        this.addStart(1, 2, 'up');
        this.addStart(10, 2, 'up');
        this.addStart(0, 2, 'up');
        return this.addStart(11, 2, 'up');
      },

      anewstart() {
        this.addWall(3, 0, 'up');
        this.addWall(4, 0, 'up');
        this.addWall(7, 0, 'up');
        this.addWall(8, 0, 'up');

        this.addStart(4, 2, 'up');
        this.addStart(7, 2, 'up');
        this.addStart(3, 2, 'up');
        this.addStart(8, 2, 'up');
        this.addStart(1, 2, 'up');
        this.addStart(10, 2, 'up');
        this.addStart(2, 2, 'up');
        return this.addStart(9, 2, 'up');
      },

      roller() {
        this.setRoller(0, 2, 'rrdrrr');
        this.setRoller(11, 2, 'lldlll');

        this.addWall(2, 0, 'up');
        this.addWall(4, 0, 'up');
        this.addWall(7, 0, 'up');
        this.addWall(9, 0, 'up');
        this.addWall(4, 0, 'left');
        this.addWall(7, 0, 'right');

        this.addWall(1, 1, 'left');
        this.addWall(2, 1, 'left');
        this.addWall(10, 1, 'left');
        this.addWall(11, 1, 'left');
        this.addWall(8, 2, 'left');
        this.addWall(6, 2, 'left');
        this.addWall(6, 3, 'left');

        this.addStart(5, 3, 'up');
        this.addStart(6, 3, 'up');
        this.addStart(3, 2, 'up');
        this.addStart(8, 2, 'up');
        this.addStart(1, 1, 'up');
        this.addStart(10, 1, 'up');
        this.addStart(0, 0, 'up');
        return this.addStart(11, 0, 'up');
      },

      roller2() {
        this.setRoller(0, 2, 'rrdrrr');
        this.setRoller(11, 2, 'lldlll');

        this.addWall(2, 0, 'up');
        this.addWall(4, 0, 'up');
        this.addWall(7, 0, 'up');
        this.addWall(9, 0, 'up');
        this.addWall(4, 0, 'left');
        this.addWall(7, 0, 'right');

        this.addWall(1, 1, 'left');
        this.addWall(2, 1, 'left');
        this.addWall(10, 1, 'left');
        this.addWall(11, 1, 'left');
        this.addWall(8, 2, 'left');
        this.addWall(6, 2, 'left');
        this.addWall(6, 3, 'left');

        this.addStart(5, 2, 'up');
        this.addStart(6, 2, 'up');
        this.addStart(4, 2, 'up');
        this.addStart(7, 2, 'up');
        this.addStart(1, 1, 'up');
        this.addStart(10, 1, 'up');
        this.addStart(0, 0, 'up');
        return this.addStart(11, 0, 'up');
      },

      crowd() {
        this.addWall(1, 2, 'left');
        this.addWall(3, 2, 'left');
        this.addWall(5, 2, 'left');
        this.addWall(6, 2, 'left');
        this.addWall(8, 2, 'left');
        this.addWall(10, 2, 'left');
        this.addWall(11, 2, 'left');
        this.addWall(2, 2, 'left');
        this.addWall(4, 2, 'left');
        this.addWall(7, 2, 'left');
        this.addWall(9, 2, 'left');

        this.addStart(5, 2, 'up');
        this.addStart(6, 2, 'up');
        this.addStart(4, 2, 'up');
        this.addStart(7, 2, 'up');
        this.addStart(3, 2, 'up');
        this.addStart(8, 2, 'up');
        this.addStart(2, 2, 'up');
        this.addStart(9, 2, 'up');
        this.addStart(1, 2, 'up');
        this.addStart(10, 2, 'up');
        this.addStart(0, 2, 'up');
        return this.addStart(11, 2, 'up');
      },

      test() {
        this.addStart(0, 0, 'up');
        this.addStart(1, 0, 'up');
        this.addStart(2, 0, 'up');
        return this.addStart(3, 0, 'up');
      },

      dev_test() {
        // Three robots in a row at the right edge of a 12-wide board (positioned
        // by an x_offset/y_offset chosen at the call site). A moves 3 to push B
        // and C off, then A walks off itself.
        this.addStart(9, 3, 'right'); // A
        this.addStart(10, 3, 'up'); // B
        this.addStart(11, 3, 'up'); // C
        // Extra slots so additional players can still join without breaking the test.
        this.addStart(0, 3, 'up');
        this.addStart(1, 3, 'up');
        this.addStart(2, 3, 'up');
        this.addStart(3, 3, 'up');
        return this.addStart(4, 3, 'up');
      },
    };
    this.course = {
      test_pit() {
        return this.setVoid(1, 3);
      },

      test() {
        this.setVoid(1, 1);
        this.setRoller(0, 3, 'ur');
        this.setExpressRoller(3, 3, 'uul');
        this.setExpressRoller(2, 2, 'r');
        this.setGear(1, 3, 'cw');
        this.setGear(2, 3, 'ccw');
        this.setPusher(1, 0, 'down', 'even');
        this.setPusher(2, 0, 'up', 'odd');
        this.setOption(2, 1);
        this.setRepair(0, 1);
        this.addWall(1, 2, 'right');
        this.addWall(3, 0, 'up');
        this.addLaser(1, 2, 'd', 2);
        return this.addDoubleLaser(0, 1, 'r', 1);
      },

      anewmap() {
        this.setVoid(6, 9);
        this.setExpressRoller(8, 8, 'rrrdddd');
        this.setExpressRoller(8, 9, 'rrrd');
        this.setExpressRoller(4, 8, 'lllldddd');
        this.setExpressRoller(4, 9, 'lllld');
        this.setExpressRoller(10, 6, 'uuuu');
        this.setRoller(11, 1, 'dddddd');
        this.setPusher(10, 6, 'right', 'odd');
        this.setPusher(10, 5, 'right', 'even');
        return this.setPusher(10, 4, 'right', 'odd');
      },

      quarterpounder() {
        this.setVoid(6, 0);
        this.setVoid(5, 2);
        this.setVoid(1, 5);
        this.setVoid(2, 6);
        this.setVoid(5, 9);
        this.setVoid(9, 9);
        this.setVoid(6, 10);
        this.setRoller(5, 1, 'lllldddd');
        this.setRoller(2, 5, 'uuurrr');
        this.setRoller(0, 9, 'rr');
        this.setRoller(3, 9, 'rr');
        this.setRoller(2, 11, 'uu');
        this.setRoller(2, 8, 'uu');
        this.setRoller(11, 1, 'ddddluuuu');
        this.setRoller(10, 0, 'llll');
        this.setRoller(9, 1, 'ddddluuuuu');
        this.setRoller(7, 1, 'ddluuu');
        this.setRoller(9, 6, 'ddd');
        this.setRoller(9, 11, 'uu');
        this.setRoller(6, 9, 'rrr');
        this.setRoller(11, 9, 'll');
        this.setPusher(1, 0, 'down', 'even');
        this.setPusher(2, 0, 'down', 'odd');
        this.setRepair(3, 0);
        this.setOption(0, 2);
        this.setOption(0, 8);
        this.setRepair(11, 8);
        this.setOption(5, 5);
        this.setOption(6, 6);
        this.setRepair(5, 6);
        this.setRepair(6, 5);
        this.setExpressRoller(5, 4, 'rrdddllluuur');
        this.addLaser(4, 4, 'r', 4);
        this.addLaser(7, 7, 'l', 4);
        this.setGear(2, 9, 'cw');
        this.addWall(5, 1, 'right');
        this.addWall(5, 3, 'right');
        this.addWall(5, 8, 'right');
        this.addWall(5, 10, 'right');
        this.addWall(5, 11, 'right');
        this.addWall(0, 5, 'down');
        this.addWall(3, 5, 'down');
        this.addWall(8, 5, 'down');
        this.addWall(9, 5, 'down');
        this.addWall(10, 5, 'down');
        this.addWall(11, 5, 'down');
        this.addWall(0, 0, 'up-left');
        this.addWall(11, 0, 'up-right');
        this.addWall(11, 11, 'down-right');
        this.addWall(0, 11, 'down-left');
        this.addWall(5, 11, 'right');
        this.addWall(3, 0, 'up');
        this.addWall(0, 2, 'left');
        this.addWall(0, 8, 'left');
        this.addWall(11, 8, 'right');
        this.addWall(11, 3, 'right');
        this.addWall(11, 2, 'right');
        this.addWall(9, 0, 'up');
        return Area.boundaryWalls.call(this);
      },

      cross() {
        this.setVoid(9, 2);
        this.setVoid(1, 4);
        this.setVoid(2, 4);
        this.setVoid(5, 4);
        this.setVoid(4, 5);
        this.setVoid(5, 5);
        this.setVoid(6, 5);
        this.setVoid(5, 6);
        this.setVoid(9, 8);
        this.setVoid(2, 10);
        this.setVoid(0, 11);

        this.setRoller(1, 0, 'drrrrddldldllll');
        this.setRoller(5, 0, 'dd');
        this.setRoller(11, 1, 'luu');
        this.setRoller(11, 5, 'lllluluuuuu');
        this.setRoller(0, 6, 'rrrrdrddddd');
        this.setRoller(0, 10, 'rdd');
        this.setRoller(10, 11, 'ulllluuuurrrrrr');
        this.setRoller(6, 11, 'uu');

        this.setRepair(11, 0);
        this.setRepair(0, 9);
        this.setOption(2, 3);
        this.setOption(9, 7);

        this.addWall(1, 3, 'right-down');
        this.addWall(3, 3, 'right');
        this.addWall(7, 3, 'left-down');
        this.addWall(9, 4, 'down');
        this.addWall(0, 7, 'down');
        this.addWall(7, 7, 'left-up');
        this.addWall(10, 7, 'up');
        this.addWall(4, 8, 'up');
        this.addWall(2, 9, 'right');
        this.addWall(9, 11, 'right');
        this.addWall(7, 11, 'right');
        Area.boundaryWalls.call(this);

        this.addLaser(4, 0, 'd', 3);
        this.addLaser(2, 8, 'r', 2);
        this.addLaser(7, 8, 'r', 2);

        return this.addDoubleLaser(8, 1, 'd', 3);
      },

      vault() {
        this.setVoid(2, 3);
        this.setVoid(9, 3);
        this.setVoid(2, 8);
        this.setVoid(9, 8);

        this.setRoller(1, 0, 'dll');
        this.setRoller(3, 0, 'u');
        this.setRoller(9, 0, 'ldlllll');
        this.setRoller(8, 0, 'd');
        this.setRoller(0, 6, 'rddddrrrrdd');
        this.setRoller(8, 10, 'rrrr');

        this.setExpressRoller(10, 1, 'ddrr');
        this.setExpressRoller(10, 6, 'rr');

        this.setRepair(0, 11);
        this.setRepair(11, 0);

        this.setOption(5, 5);
        this.setOption(5, 6);
        this.setOption(6, 5);
        this.setOption(6, 6);

        this.setGear(3, 1, 'cw');
        this.setGear(10, 0, 'cw');

        this.setPusher(5, 2, 'up', 'odd');
        this.setPusher(10, 5, 'down', 'even');
        this.setPusher(2, 6, 'left', 'odd');
        this.setPusher(9, 6, 'right', 'odd');
        this.setPusher(5, 9, 'down', 'even');
        this.setPusher(6, 9, 'down', 'odd');

        this.addWall(6, 2, 'down');
        this.addWall(11, 2, 'right');
        this.addWall(4, 4, 'left');
        this.addWall(7, 4, 'right');
        this.addWall(2, 5, 'right');
        this.addWall(9, 5, 'left');
        this.addWall(3, 7, 'left');
        this.addWall(7, 7, 'right');

        this.addLaser(4, 0, 'd', 4);
        this.addLaser(7, 0, 'd', 4);
        this.addLaser(0, 2, 'r', 4);
        this.addLaser(4, 8, 'd', 4);
        this.addLaser(7, 8, 'd', 4);

        return Area.boundaryWalls.call(this);
      },

      maelstrom() {
        this.setVoid(5, 5);
        this.setVoid(6, 5);
        this.setVoid(5, 6);
        this.setVoid(6, 6);

        this.setRoller(1, 0, 'drrrrrrrrrddddddddlllllllluuuuuurrrrrrddddlllluur');
        this.setRoller(5, 0, 'dr');
        this.setRoller(6, 0, 'u');
        this.setRoller(11, 1, 'ld');
        this.setRoller(11, 5, 'ld');
        this.setRoller(0, 5, 'l');

        this.setExpressRoller(10, 11, 'ullllllllluuuuuuuurrrrrrrrddddddlllllluuuurrrrddl');
        this.setExpressRoller(6, 11, 'ul');
        this.setExpressRoller(0, 10, 'ru');
        this.setExpressRoller(0, 6, 'ru');

        this.setPusher(4, 0, 'down', 'odd');
        this.setPusher(7, 0, 'down', 'odd');
        this.setPusher(4, 11, 'up', 'odd');
        this.setPusher(7, 11, 'up', 'odd');
        this.setPusher(11, 4, 'left', 'odd');
        this.setPusher(11, 7, 'left', 'odd');
        this.setPusher(0, 4, 'right', 'odd');
        this.setPusher(0, 7, 'right', 'odd');

        this.setPusher(2, 0, 'down', 'even');
        this.setPusher(9, 0, 'down', 'even');
        this.setPusher(2, 11, 'up', 'even');
        this.setPusher(9, 11, 'up', 'even');
        this.setPusher(11, 2, 'left', 'even');
        this.setPusher(11, 9, 'left', 'even');
        this.setPusher(0, 2, 'right', 'even');
        this.setPusher(0, 9, 'right', 'even');

        this.setRepair(0, 0);
        this.setRepair(11, 11);
        this.setOption(11, 3);
        this.setOption(0, 8);

        this.addLaser(5, 3, 'd', 5);
        this.addLaser(6, 4, 'd', 5);
        this.addLaser(4, 5, 'r', 5);
        return this.addLaser(3, 4, 'r', 5);
      },

      chess() {
        this.setVoid(3, 3);
        this.setVoid(6, 4);
        this.setVoid(8, 6);
        this.setVoid(5, 7);

        this.setExpressRoller(2, 1, 'rrrrrrrrdddddddddllllllllluuuuuuuuurr');
        this.setRoller(2, 2, 'r');
        this.setRoller(2, 4, 'r');
        this.setRoller(2, 6, 'r');
        this.setRoller(2, 8, 'r');
        this.setRoller(4, 2, 'r');
        this.setRoller(4, 4, 'r');
        this.setRoller(4, 6, 'r');
        this.setRoller(4, 8, 'r');

        this.setRoller(3, 5, 'r');
        this.setRoller(3, 7, 'r');
        this.setRoller(3, 9, 'r');

        this.setRoller(5, 3, 'r');
        this.setRoller(5, 9, 'r');

        this.setRoller(7, 3, 'l');
        this.setRoller(7, 5, 'l');
        this.setRoller(7, 7, 'l');
        this.setRoller(7, 9, 'l');
        this.setRoller(9, 3, 'l');
        this.setRoller(9, 5, 'l');
        this.setRoller(9, 7, 'l');
        this.setRoller(9, 9, 'l');

        this.setRoller(8, 2, 'l');
        this.setRoller(8, 4, 'l');
        this.setRoller(8, 8, 'l');

        this.setRoller(6, 2, 'l');
        this.setRoller(6, 8, 'l');

        this.setOption(5, 5);
        this.setOption(6, 6);
        this.setRepair(11, 0);
        this.setRepair(0, 11);

        this.addWall(3, 1, 'd');
        this.addWall(5, 1, 'd');
        this.addWall(6, 1, 'd');
        this.addWall(8, 1, 'd');
        this.addWall(3, 10, 'u');
        this.addWall(5, 10, 'u');
        this.addWall(6, 10, 'u');
        this.addWall(8, 10, 'u');
        this.addWall(1, 3, 'r');
        this.addWall(1, 5, 'r');
        this.addWall(1, 6, 'r');
        this.addWall(1, 8, 'r');
        this.addWall(10, 3, 'l');
        this.addWall(10, 5, 'l');
        this.addWall(10, 6, 'l');
        this.addWall(10, 8, 'l');
        return Area.boundaryWalls.call(this);
      },

      spin_zone() {
        this.setGear(2, 2, 'cw');
        this.setGear(3, 3, 'cw');
        this.setGear(2, 8, 'cw');
        this.setGear(3, 9, 'cw');
        this.setGear(8, 2, 'cw');
        this.setGear(9, 3, 'cw');
        this.setGear(8, 8, 'cw');
        this.setGear(9, 9, 'cw');

        this.setGear(5, 2, 'ccw');
        this.setGear(6, 4, 'ccw');
        this.setGear(4, 5, 'ccw');
        this.setGear(9, 5, 'ccw');
        this.setGear(2, 6, 'ccw');
        this.setGear(7, 6, 'ccw');
        this.setGear(5, 7, 'ccw');
        this.setGear(6, 9, 'ccw');

        this.setRepair(2, 3);
        this.setRepair(9, 8);
        this.setOption(8, 3);
        this.setOption(3, 8);

        this.setExpressRoller(2, 1, 'rrdddllluuurr');
        this.setExpressRoller(8, 1, 'rrdddllluuurr');
        this.setExpressRoller(2, 7, 'rrdddllluuurr');
        this.setExpressRoller(8, 7, 'rrdddllluuurr');

        this.addLaser(3, 3, 'd', 4);
        this.addLaser(5, 3, 'r', 2);
        this.addLaser(8, 5, 'd', 4);
        this.addLaser(5, 8, 'r', 2);
        return Area.boundaryWalls.call(this);
      },
      island() {
        this.setGear(2, 9, 'cw');
        this.setGear(9, 9, 'cw');

        this.setGear(3, 3, 'ccw');
        this.setGear(3, 8, 'ccw');
        this.setGear(8, 3, 'ccw');
        this.setGear(8, 8, 'ccw');

        this.setRepair(0, 11);
        this.setRepair(11, 2);
        this.setOption(5, 6);

        this.setRoller(3, 2, 'rrrrrrr');
        this.setRoller(9, 3, 'dddddd');
        this.setRoller(8, 9, 'llllll');
        this.setRoller(2, 8, 'uuuuuuu');
        this.setRoller(7, 3, 'llll');
        this.setRoller(4, 8, 'rrrr');
        this.setRoller(3, 4, 'dddd');
        this.setRoller(5, 5, 'lld');
        this.setRoller(8, 7, 'uuuu');
        this.setRoller(6, 6, 'rru');

        this.setVoid(1, 1);
        this.setVoid(2, 1);
        this.setVoid(1, 2);
        this.setVoid(9, 1);
        this.setVoid(10, 1);
        this.setVoid(10, 2);
        this.setVoid(1, 9);
        this.setVoid(1, 10);
        this.setVoid(2, 10);
        this.setVoid(10, 9);
        this.setVoid(10, 10);
        this.setVoid(9, 10);
        this.setVoid(6, 4);
        this.setVoid(7, 4);
        this.setVoid(7, 5);
        this.setVoid(4, 6);
        this.setVoid(4, 7);
        this.setVoid(5, 7);
        return Area.boundaryWalls.call(this);
      },

      exchange() {
        this.setGear(10, 1, 'cw');
        this.setGear(10, 10, 'cw');
        this.setGear(3, 3, 'ccw');
        this.setGear(3, 8, 'ccw');
        this.setGear(8, 8, 'ccw');

        this.setRepair(0, 0);
        this.setRepair(11, 11);
        this.setOption(7, 7);

        this.setRoller(0, 1, 'l');
        this.setRoller(0, 3, 'rrr');
        this.setRoller(4, 5, 'lllll');
        this.setRoller(11, 5, 'lllll');
        this.setRoller(1, 6, 'rrrr');
        this.setRoller(2, 8, 'lll');
        this.setRoller(3, 2, 'uuu');
        this.setRoller(3, 11, 'uuu');
        this.setRoller(5, 0, 'ddddd');
        this.setRoller(6, 4, 'uuuuu');
        this.setRoller(6, 10, 'uuuu');
        this.setRoller(8, 0, 'dddd');
        this.setRoller(8, 9, 'ddd');
        this.setRoller(10, 0, 'u');
        this.setRoller(11, 1, 'l');
        this.setRoller(11, 8, 'lll');
        this.setRoller(11, 10, 'r');
        this.setRoller(10, 11, 'u');
        this.setExpressRoller(5, 7, 'ddddd');
        this.setExpressRoller(7, 6, 'rrrrr');
        this.setExpressRoller(9, 3, 'rrr');

        this.setVoid(2, 1);
        this.setVoid(0, 10);

        this.addLaser(9, 2, 'r', 3);
        this.addWall(4, 4, 'right-down');
        this.addWall(4, 7, 'up-right');
        this.addWall(7, 7, 'left-up');
        this.addWall(7, 4, 'left-down');
        this.addWall(1, 10, 'down');
        this.addWall(10, 9, 'up');
        return Area.boundaryWalls.call(this);
      },
      chop_shop() {
        this.setGear(5, 3, 'cw');
        this.setGear(8, 7, 'cw');
        this.setGear(5, 9, 'cw');
        this.setGear(8, 3, 'ccw');
        this.setGear(4, 5, 'ccw');
        this.setGear(8, 6, 'ccw');
        this.setGear(6, 9, 'ccw');

        this.setRepair(0, 11);
        this.setRepair(11, 0);
        this.setOption(4, 2);
        this.setOption(5, 6);
        this.setOption(9, 9);

        this.setVoid(3, 2);
        this.setVoid(9, 2);
        this.setVoid(6, 4);
        this.setVoid(9, 6);
        this.setVoid(1, 10);

        this.setRoller(1, 0, 'ddrr');
        this.setRoller(5, 0, 'ddd');
        this.setRoller(8, 0, 'ddd');
        this.setRoller(0, 3, 'rrr');
        this.setRoller(9, 3, 'rrr');
        this.setRoller(5, 4, 'drrr');
        this.setRoller(3, 5, 'llll');
        this.setRoller(4, 6, 'u');
        this.setRoller(11, 8, 'lll');
        this.setRoller(5, 10, 'dd');
        this.setRoller(6, 11, 'urrrr');
        this.setRoller(11, 10, 'r');
        this.setExpressRoller(7, 8, 'llllllll');
        this.setExpressRoller(0, 6, 'rrddl');

        this.addLaser(4, 3, 'r', 3);
        this.addLaser(10, 2, 'd', 3);
        this.addLaser(1, 6, 'd', 3);
        this.addLaser(2, 9, 'r', 6);
        this.addDoubleLaser(8, 5, 'd', 4);
        this.addLaser(10, 10, 'd', 1, 3);

        this.addWall(6, 1, 'r');
        this.addWall(5, 5, 'd');
        this.addWall(3, 6, 'right-down');
        return Area.boundaryWalls.call(this);
      },
      crowd_chess() {
        this.setVoid(3, 3);
        this.setVoid(6, 4);
        this.setVoid(8, 6);
        this.setVoid(5, 7);

        this.setExpressRoller(2, 1, 'rrrrrrrrdddddddddllllllllluuuuuuuuurr');
        this.setRoller(2, 2, 'r');
        this.setRoller(2, 4, 'r');
        this.setRoller(2, 6, 'r');
        this.setRoller(2, 8, 'r');
        this.setRoller(4, 2, 'r');
        this.setRoller(4, 4, 'r');
        this.setRoller(4, 6, 'r');
        this.setRoller(4, 8, 'r');

        this.setRoller(3, 5, 'r');
        this.setRoller(3, 7, 'r');
        this.setRoller(3, 9, 'r');

        this.setRoller(5, 3, 'r');
        this.setRoller(5, 9, 'r');

        this.setRoller(7, 3, 'l');
        this.setRoller(7, 5, 'l');
        this.setRoller(7, 7, 'l');
        this.setRoller(7, 9, 'l');
        this.setRoller(9, 3, 'l');
        this.setRoller(9, 5, 'l');
        this.setRoller(9, 7, 'l');
        this.setRoller(9, 9, 'l');

        this.setRoller(8, 2, 'l');
        this.setRoller(8, 4, 'l');
        this.setRoller(8, 8, 'l');

        this.setRoller(6, 2, 'l');
        this.setRoller(6, 8, 'l');

        this.setOption(5, 5);
        this.setOption(6, 6);
        this.setRepair(11, 0);
        this.setRepair(0, 11);

        this.addWall(3, 1, 'd');
        this.addWall(5, 1, 'd');
        this.addWall(6, 1, 'd');
        this.addWall(8, 1, 'd');
        this.addWall(3, 10, 'u');
        this.addWall(5, 10, 'u');
        this.addWall(6, 10, 'u');
        this.addWall(8, 10, 'u');
        this.addWall(1, 3, 'r');
        this.addWall(1, 5, 'r');
        this.addWall(1, 6, 'r');
        this.addWall(1, 8, 'r');
        this.addWall(10, 3, 'l');
        this.addWall(10, 5, 'l');
        this.addWall(10, 6, 'l');
        this.addWall(10, 8, 'l');

        this.addWall(2, 0, 'u');
        this.addWall(4, 0, 'u');
        this.addWall(7, 0, 'u');
        this.addWall(9, 0, 'u');
        this.addWall(0, 2, 'l');
        this.addWall(0, 4, 'l');
        this.addWall(0, 7, 'l');
        this.addWall(0, 9, 'l');
        this.addWall(11, 2, 'r');
        this.addWall(11, 4, 'r');
        this.addWall(11, 7, 'r');
        return this.addWall(11, 9, 'r');
      },

      canner_row() {
        this.setVoid(6, 0);
        this.setVoid(5, 2);
        this.setVoid(9, 8);

        this.setPusher(5, 10, 'right', 'even');
        this.setPusher(8, 9, 'right', 'odd');
        this.setPusher(10, 9, 'left', 'even');

        this.setExpressRoller(0, 0, 'rrrr');
        this.setExpressRoller(11, 0, 'dddddlllll');
        this.setExpressRoller(0, 11, 'uuuuurrrr');
        this.setExpressRoller(11, 11, 'lllll');
        this.setExpressRoller(8, 6, 'rdd');

        this.setRoller(4, 0, 'dddddddddddrd');
        this.setRoller(5, 0, 'ld');
        this.setRoller(5, 4, 'ru');
        this.setRoller(5, 5, 'ld');
        this.setRoller(5, 6, 'ru');
        this.setRoller(5, 7, 'ld');
        this.setRoller(11, 10, 'uuuur');

        this.setRoller(6, 11, 'uuuuuuuuuuld');

        this.setOption(3, 5);
        this.setOption(9, 10);
        this.setOption(5, 8);
        this.setRepair(10, 1);
        this.setRepair(1, 10);

        this.addWall(2, 0, 'u');
        this.addWall(4, 0, 'u');
        this.addWall(7, 0, 'u');
        this.addWall(9, 0, 'u');
        this.addWall(9, 0, 'd');
        this.addWall(10, 0, 'r');

        this.addWall(2, 1, 'u');
        this.addWall(9, 1, 'r');

        this.addWall(0, 2, 'l');
        this.addWall(1, 2, 'u');
        this.addWall(1, 2, 'r');
        this.addWall(2, 2, 'r');
        this.addWall(8, 2, 'r');
        this.addWall(8, 2, 'l');
        this.addWall(11, 2, 'r');

        this.addWall(1, 3, 'l');
        this.addWall(3, 3, 'r');
        this.addWall(5, 3, 'u');
        this.addWall(5, 3, 'd');
        this.addWall(9, 3, 'u');

        this.addWall(0, 4, 'l');
        this.addWall(2, 4, 'u');
        this.addWall(3, 4, 'd');
        this.addWall(10, 4, 'r');
        this.addWall(11, 4, 'r');
        this.addWall(8, 4, 'u');
        this.addWall(10, 4, 'u');

        this.addWall(1, 5, 'u');
        this.addWall(2, 5, 'd');
        this.addWall(8, 5, 'u');
        this.addWall(9, 5, 'u');

        this.addWall(3, 6, 'd');

        this.addWall(0, 7, 'l');
        this.addWall(1, 7, 'l');
        this.addWall(1, 7, 'u');
        this.addWall(2, 7, 'd');
        this.addWall(10, 7, 'd');
        this.addWall(11, 7, 'r');

        this.addWall(2, 8, 'r');
        this.addWall(3, 8, 'r');
        this.addWall(7, 8, 'd');

        this.addWall(0, 9, 'l');
        this.addWall(1, 9, 'u');
        this.addWall(1, 9, 'r');
        this.addWall(3, 9, 'd');
        this.addWall(5, 9, 'u');
        this.addWall(8, 9, 'l');
        this.addWall(9, 9, 'u');
        this.addWall(9, 9, 'd');
        this.addWall(10, 9, 'r');
        this.addWall(11, 9, 'r');

        this.addWall(2, 10, 'd');
        this.addWall(4, 10, 'l');
        this.addWall(8, 10, 'd');
        this.addWall(10, 10, 'l');
        this.addWall(10, 10, 'd');

        this.addWall(2, 11, 'd');
        this.addWall(7, 11, 'd');
        this.addWall(9, 11, 'd');

        this.addDoubleLaser(9, 0, 'd', 1);
        this.addDoubleLaser(2, 2, 'l', 1);
        this.addDoubleLaser(8, 2, 'r', 1);
        this.addLaser(5, 3, 'u', 1);
        this.addLaser(9, 3, 'd', 2);
        this.addLaser(2, 4, 'd', 2);
        this.addLaser(1, 5, 'd', 2);
        this.addLaser(4, 10, 'l', 1);
        return this.addDoubleLaser(9, 9, 'u', 1);
      },
    };
  }
  static boundaryWalls() {
    this.addWall(2, 0, 'u');
    this.addWall(4, 0, 'u');
    this.addWall(7, 0, 'u');
    this.addWall(9, 0, 'u');
    this.addWall(2, 11, 'd');
    this.addWall(4, 11, 'd');
    this.addWall(7, 11, 'd');
    this.addWall(9, 11, 'd');
    this.addWall(0, 2, 'l');
    this.addWall(0, 4, 'l');
    this.addWall(0, 7, 'l');
    this.addWall(0, 9, 'l');
    this.addWall(11, 2, 'r');
    this.addWall(11, 4, 'r');
    this.addWall(11, 7, 'r');
    return this.addWall(11, 9, 'r');
  }
}
Area.initClass();
