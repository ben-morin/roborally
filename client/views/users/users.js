import './users.html';

Template.usersPill.helpers({
  usersOnline() {
    if (!Meteor.userId()) return [];
    return Meteor.users.find();
  },
  userPillClass() {
    return {
      class: `users-pill badge ${this.status?.idle ? 'text-bg-warning' : 'text-bg-success'}`,
    };
  },
});
