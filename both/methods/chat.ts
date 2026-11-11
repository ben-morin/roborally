import './config.ts';
import { createMethod } from 'meteor/jam:method';
import { GameState } from '../gamestate.ts';
import { getUsername } from '../permissions.ts';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';
import { Chat } from '../../collections/chat.ts';
import { Games } from '../../collections/games.ts';
import type { GameDoc } from '../../collections/games.ts';

// How long a finished game's chat stays open, for the last words.
export const CHAT_GRACE_MS = 3 * 60_000;

/** When a game's chat closes, in epoch milliseconds; undefined while the game is on. */
export function chatClosesAt(game: Pick<GameDoc, 'gamePhase' | 'stopped'>) {
  if (game.gamePhase !== GameState.PHASE.ENDED) return undefined;
  // With no end time to count from, the chat counts as long closed.
  return (game.stopped ?? 0) + CHAT_GRACE_MS;
}

export const addMessage = createMethod({
  name: 'addMessage',
  // Sized against what a player can legitimately do: this one is typing. Meteor
  // rate-limits its own login and account methods and leaves the rest to the app, so the
  // six methods a client can drive in a loop carry their own rule — the three that insert
  // documents, the one that drives the phase machine, the one that sends mail and the one
  // that checks a password.
  rateLimit: { limit: 5, interval: 5000 },
  validate: checkArgsWith(schemas.addMessage),
  async run({ message, gameId }: Doc<typeof schemas.addMessage>) {
    // `open: false` from ./config.ts, so the package's logged-in check has already run and
    // this cannot resolve to null — the `!` records the TypeError a missing user throws.
    const user = (await Meteor.userAsync())!;

    if (gameId !== 'global') {
      const game = await Games.findOneAsync(gameId, { fields: { gamePhase: 1, stopped: 1 } });
      const closesAt = game && chatClosesAt(game);
      if (closesAt !== undefined && Date.now() >= closesAt) {
        throw new Meteor.Error(403, 'The chat for this game is closed.');
      }
    }

    await Chat.insertAsync({
      message,
      gameId,
      userId: user._id,
      author: getUsername(user),
      submitted: new Date().getTime(),
    });
  },
});
