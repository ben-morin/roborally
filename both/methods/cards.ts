import './config.ts';
import { createMethod } from 'meteor/jam:method';
import { CardLogic } from '../cardlogic.ts';
import { GameLogic } from '../gamelogic.ts';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';
import { Games } from '../../collections/games.ts';
import { Players } from '../../collections/players.ts';

// The card surface: the three register-selection methods, the submit, and the power-down
// toggle.
//
// `selectCard`, `deselectCard` and `deselectAllCards` are the only methods in the app that
// ask for `serverOnly: false`, and that opt-in is the reason this module is shared code
// rather than server code. Their bodies run twice — once against minimongo the moment the
// click lands, which is what fills the register slot without waiting for the round trip,
// and once for real on the server, whose write then replaces the simulated one. Everything
// else here takes the app-wide `serverOnly: true` from ./config.ts and runs on the server
// only, `playCards` and `togglePowerDown` included.
//
// A simulated body may therefore touch nothing the browser does not have. `Players`, and
// the `Cards` doc that `chooseCardAsync` writes through, both arrive on the `players` and
// `cards` subscriptions every client on /board/:id holds; a server-only import, or a
// collection the client cannot see, would throw inside the stub — and with
// `throwStubExceptions` on by default that rejects the call before the server hears about
// it.

export const selectCard = createMethod({
  name: 'selectCard',
  serverOnly: false,
  validate: checkArgsWith(schemas.selectCard),
  async run({ gameId, card, index }: Doc<typeof schemas.selectCard>) {
    // Every method here is `open: false` (./config.ts), so the logged-in check has already
    // run — in the stub as well as on the server — and there is a user id to query on.
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId()! });
    if (!player) return;
    if (index < player.notLockedCnt()) await player.chooseCardAsync(card, index);
    return await player.getChosenCardsAsync();
  },
});

export const deselectCard = createMethod({
  name: 'deselectCard',
  serverOnly: false,
  validate: checkArgsWith(schemas.deselectCard),
  async run({ gameId, index }: Doc<typeof schemas.deselectCard>) {
    // Logged in, as in selectCard above.
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId()! });
    if (!player) return;
    if (index < player.notLockedCnt()) await player.unchooseCardAsync(index);
    return await player.getChosenCardsAsync();
  },
});

export const deselectAllCards = createMethod({
  name: 'deselectAllCards',
  serverOnly: false,
  validate: checkArgsWith(schemas.deselectAllCards),
  async run({ gameId }: Doc<typeof schemas.deselectAllCards>) {
    // Logged in, as in selectCard above.
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId()! });
    if (!player) return;
    for (let i = 0; i < player.notLockedCnt(); i++) await player.unchooseCardAsync(i);
  },
});

export const playCards = createMethod({
  name: 'playCards',
  // Once per turn plus the occasional retry after a reconnect.
  rateLimit: { limit: 5, interval: 5000 },
  validate: checkArgsWith(schemas.playCards),
  async run({ gameId, programRound }: Doc<typeof schemas.playCards>) {
    const game = await Games.findOneAsync(gameId);
    // Logged in, as in selectCard above.
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId()! });
    if (!game || !player) throw new Meteor.Error(404, `Game/Player not found! ${gameId}`);

    // A submit can arrive a whole turn late: the final submitter's call spans the
    // entire turn (submitCardsAsync awaits the phase machine), so a duplicate queued
    // behind it on the same connection — or a Meteor retry after a reconnect —
    // executes against the NEXT program phase, where `submitted` has been reset and
    // the check below passes again. The round number pins a submission to the turn
    // the client actually saw.
    if (programRound !== game.programRound) {
      throw new Meteor.Error(409, 'This submission was for a previous turn.');
    }

    if (player.submitted) {
      console.warn('Player already submitted his cards.');
      return;
    }

    // Filling empty slots with random cards is the timeout penalty, not a player
    // choice: outside the expired-timer window an incomplete program can only be a
    // stale or hand-crafted call, so refuse it rather than submit five random cards.
    if (
      !player.isPoweredDown() &&
      (player.chosenCardsCnt ?? 0) < GameLogic.CARD_SLOTS &&
      game.timer !== 0
    ) {
      throw new Meteor.Error(403, 'Not all program slots are filled.');
    }

    await player.chatAsync('submitted cards');
    await CardLogic.submitCardsAsync(player);
  },
});

export const togglePowerDown = createMethod({
  name: 'togglePowerDown',
  validate: checkArgsWith(schemas.togglePowerDown),
  async run({ gameId }: Doc<typeof schemas.togglePowerDown>) {
    // Logged in, as in selectCard above.
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId()! });
    if (!player) throw new Meteor.Error(404, `Player not found! ${gameId}`);

    return await player.togglePowerDownAsync();
  },
});
