Template.usersPill.helpers({
  usersOnline: function () {
   return Meteor.users.find();
  },
  userPillClass: function () {
    return {
      class: 'users-pill badge ' + (this.status && this.status.idle ? 'text-bg-warning' : 'text-bg-success')
    };
  }
});
