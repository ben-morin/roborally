export const Chat = new Meteor.Collection('chat');

Chat.allow({
  insert(_userId, _doc) {
    return false;
  },
  update(_userId, _doc) {
    return false;
  },
  remove(_userId, _doc) {
    return false;
  },
});
