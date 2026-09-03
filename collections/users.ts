// A load-time observe, on both architectures. On the server the documents are whole; on
// the client they are what the `onlineUsers` publication sends, which is `profile.name`
// and presence and nothing else — hence getUsername() rather than reading the address
// directly, which is also why no email address reaches the browser console.
import { getUsername } from '../both/permissions.ts';

Meteor.users.find({ 'status.online': true }).observe({
  added(user) {
    console.log(`User ${getUsername(user)} (${user._id}) online!`);
  },
  removed(user) {
    console.log(`User ${getUsername(user)} (${user._id}) offline!`);
  },
});
