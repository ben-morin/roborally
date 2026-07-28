// thumbnail.html includes {{> _tiles}}, so the module that owns that template
// has to be loaded too.
import './_tiles.js';
import './thumbnail.html';

Template.thumbnail.helpers({
  player() {
    return this.players.find((player) => player.userId === Meteor.userId());
  },
});
