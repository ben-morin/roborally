export const Chat = new Meteor.Collection('chat');

// Milestone 2 shim — drop once every reader imports `Chat` directly.
globalThis.Chat = Chat;

Chat.allow({
  insert: function (userId, doc) {
    return false;
  },
  update: function (userId, doc) {
    return false;
  },
  remove: function (userId, doc) {
    return false;
  },
});
