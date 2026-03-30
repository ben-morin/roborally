Meteor.users.find({ "status.online": true }).observe({
  added: function(user) {
    console.log(`User ${user.emails[0].address} (${user._id}) online!`);
  },
  removed: function(user) {
    console.log(`User ${user.emails[0].address} (${user._id}) offline!`);
  }
});
