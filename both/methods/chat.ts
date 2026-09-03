import './config.ts';
import { createMethod } from 'meteor/jam:method';
import { getUsername } from '../permissions.ts';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';
import { Chat } from '../../collections/chat.ts';

export const addMessage = createMethod({
  name: 'addMessage',
  // Sized against what a player can legitimately do: this one is typing. Meteor
  // rate-limits its own login and account methods and leaves the rest to the app, so the
  // four methods a client can drive in a loop carry their own rule — the three that insert
  // documents and the one that drives the phase machine.
  rateLimit: { limit: 5, interval: 5000 },
  validate: checkArgsWith(schemas.addMessage),
  async run({ message, gameId }: Doc<typeof schemas.addMessage>) {
    // `open: false` from ./config.ts, so the package's logged-in check has already run and
    // this cannot resolve to null — the `!` records the TypeError a missing user throws.
    const user = (await Meteor.userAsync())!;

    await Chat.insertAsync({
      message,
      gameId,
      userId: user._id,
      author: getUsername(user),
      submitted: new Date().getTime(),
    });
  },
});
