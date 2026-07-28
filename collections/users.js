Meteor.users.find({ 'status.online': true }).observe({
  added(user) {
    console.log(`User ${user.emails[0].address} (${user._id}) online!`);
  },
  removed(user) {
    console.log(`User ${user.emails[0].address} (${user._id}) offline!`);
  },
});
