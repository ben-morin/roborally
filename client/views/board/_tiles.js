import { Players } from '../../../collections/players.ts';
import './_tiles.html';

Template._tiles.helpers({
  visited_checkpoint(number) {
    const player = Players.findOne({ userId: Meteor.userId() });
    if (player != null && player.visited_checkpoints >= number) {
      return 'visited';
    } else {
      return '';
    }
  },
  leq(current, limit) {
    return current <= limit;
  },
  rotate(direction) {
    const rotate = `rotate(${90 * direction}deg);`;
    return `transform: ${rotate} -webkit-transform: ${rotate} -ms-transform: ${rotate}`;
  },
});
