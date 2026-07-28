// thumbnail.html includes {{> _tiles}}, so the module that owns that template
// has to be loaded too.
import './_tiles.js';
import './thumbnail.html';

Template.thumbnail.helpers({
  player: function () {
    for (const i in this.players) {
      const player = this.players[i];
      if (player.userId === Meteor.userId()) {
        return player;
      }
    }
  },
});
