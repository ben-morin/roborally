import { getUsername } from '../../../both/permissions.js';
import './users.html';

Template.usersPill.helpers({
  usersOnline() {
    if (!Meteor.userId()) return [];
    return Meteor.users.find();
  },
  // The `onlineUsers` publication sends `profile.name` and presence only, so the pill
  // shows the display name rather than the address it used to print. The viewer's own
  // document arrives through Meteor's automatic publication and carries the same field.
  userLabel() {
    return getUsername(this);
  },
  userPillClass() {
    return {
      class: `users-pill badge ${this.status?.idle ? 'text-bg-warning' : 'text-bg-success'}`,
    };
  },
});
