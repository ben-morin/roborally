import './config.js';
import { createMethod } from 'meteor/jam:method';
import { getUsername } from '../permissions.js';
import { checkArgsWith, schemas } from '../schemas/methods.js';
import { Chat } from '../../collections/chat.js';

export const addMessage = createMethod({
  name: 'addMessage',
  // Sized against what a player can legitimately do: this one is typing. Meteor
  // rate-limits its own login and account methods and leaves the rest to the app, so the
  // four methods a client can drive in a loop carry their own rule — the three that insert
  // documents and the one that drives the phase machine.
  rateLimit: { limit: 5, interval: 5000 },
  validate: checkArgsWith(schemas.addMessage),
  async run({ message, gameId }) {
    const user = await Meteor.userAsync();

    await Chat.insertAsync({
      message,
      gameId,
      userId: user._id,
      author: getUsername(user),
      submitted: new Date().getTime(),
    });
  },
});
