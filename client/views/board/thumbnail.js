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
