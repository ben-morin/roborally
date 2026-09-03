// This file is the server entry point (`meteor.mainModule`), so it pulls in the rest of
// the server. The side-effect imports are the files nothing else imports; `logging.js`
// comes first so it can silence `console.log` in production before anything runs. Every
// other model and collection loads transitively through these.
import '../both/logging.js';
// Before anything that reaches a collection: a schema is attached in the collection's
// module body, and it reads this configuration as it goes. See both/easySchemaConfig.js.
import '../both/easySchemaConfig.js';
// Same rule, for the same reason: jam:method reads this configuration when a method module
// runs `createMethod`. See both/methods/config.js.
import '../both/methods/config.js';
import '../both/methods/accounts.js';
import '../both/methods/cards.js';
import '../both/methods/chat.js';
import '../both/methods/games.js';
import '../collections/users.js';

import { SyncedCron } from 'meteor/quave:synced-cron';
import { autoSubmitIfTimedOut, forceSubmitStragglerAsync } from '../both/cardlogic.js';
import { GameLogic } from '../both/gamelogic.js';
import { GameState } from '../both/gamestate.js';
import { Games } from '../collections/games.js';
import { Players } from '../collections/players.js';
import { markBooted, bootedAtMs } from './boot.js';
import { buildHighscores } from './highscores.js';
import { resumeStalledTurnsAsync } from './resume.js';
import './accounts.js';
import './publications.js';

Meteor.settings = Meteor.settings || {};
Meteor.settings.public = Meteor.settings.public || {};
Meteor.settings.public.appVersion =
  process.env.APP_VERSION || process.env.npm_package_version || 'development';

// mizzao:user-status marks every user offline in its own startup hook, and clients take
// a few seconds to reconnect — after a long outage, up to five minutes of DDP back-off.
// Until they do, every live game looks abandoned; `Clean up abandoned games` sits out this
// grace from `bootedAtMs()` so a restart cannot end a game as "Nobody" or hand it to the
// first player back.
//
// `Meteor.settings.BOOT_GRACE_SEC` overrides the five minutes — in seconds, because the
// value is written by hand and nobody should have to count zeroes to set ten seconds. It is
// there for test runs, which have neither the reconnect back-off the default is measured
// against nor the patience to sit out five minutes to watch this job do anything;
// test/e2e/settings.json sets it. Leave it unset in production.
const DEFAULT_BOOT_GRACE_SEC = 5 * 60;

// Read per tick rather than once at load, so a nonsense value cannot be baked in for the
// life of the process and a test can change it between cases.
function bootGraceMs() {
  const configured = Meteor.settings?.BOOT_GRACE_SEC;
  const seconds =
    typeof configured === 'number' && configured >= 0 ? configured : DEFAULT_BOOT_GRACE_SEC;
  return seconds * 1000;
}

SyncedCron.config({ log: false });

SyncedCron.add({
  name: 'Build highscore lists',
  schedule: (parser) => parser.text('every 1 hour'),
  job: async () => {
    console.log('CRON: Building highscore lists');
    await buildHighscores();
  },
});

SyncedCron.add({
  name: 'Clean up unstarted games',
  schedule: (parser) => parser.text('every 5 minutes'),
  job: async () => {
    const openGames = await Games.find({ started: false }).fetchAsync();
    for (const game of openGames) {
      const owner = await Meteor.users.findOneAsync(game.userId);
      if (owner && !owner.status.online) {
        await delay(5000);
        const ownerRecheck = await Meteor.users.findOneAsync(game.userId);
        if (ownerRecheck && !ownerRecheck.status.online) {
          console.log(`Removing unstarted game: ${game._id}`);
          await Games.removeAsync(game._id);
        }
      }
    }
  },
});

SyncedCron.add({
  name: 'Recover stalled programming timers',
  schedule: (parser) => parser.text('every 1 minute'),
  job: async () => {
    // The programming timer is a `Meteor.setTimeout`, so it lives in this process and
    // does not survive a restart. A deploy landing mid-turn therefore leaves the game on
    // `timer: 1` forever — and nothing else recovers it: the client only auto-submits
    // when it sees `timer: 0`, so with the timer stuck at 1 both ends wait for each
    // other. This is the routine cause of a game hanging in the program phase.
    //
    // Only the programming timer is handled here. A game stalled inside the turn itself
    // is `Recover stalled turns`' business, below.
    const cutoff = new Date(Date.now() - (GameLogic.TIMER + 30) * 1000);
    const stalled = await Games.find({
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
      timer: 1,
      timerStartedAt: { $lt: cutoff },
    }).fetchAsync();

    for (const game of stalled) {
      console.log(`Recovering stalled programming timer for game ${game._id}`);
      // Hand back to the very code the lost timeout would have run. Its own guard
      // re-reads the game and checks it is still acting on this timer instance, so a
      // race with a player submitting in the meantime resolves harmlessly.
      await autoSubmitIfTimedOut(game._id, game.timerStartedAt);
    }

    // The other place the timer can die: inside the 2.5 s grace after it fired, with
    // `timer: 0` and `timerStartedAt` already cleared. An open tab re-sends its submit on
    // reconnect; a closed one leaves the game there forever. `lastStepAt` is the arming
    // claim's stamp, so the same cutoff means the grace ended at least 27 s ago and the
    // force-submit cannot overlap a live one.
    const inGrace = await Games.find({
      started: true,
      gamePhase: GameState.PHASE.PROGRAM,
      timer: 0,
      lastStepAt: { $lt: cutoff },
    }).fetchAsync();

    for (const game of inGrace) {
      console.log(`Recovering programming timer lost in its grace for game ${game._id}`);
      await forceSubmitStragglerAsync(game._id);
    }
  },
});

SyncedCron.add({
  name: 'Recover stalled turns',
  schedule: (parser) => parser.text('every 1 minute'),
  // Fire-and-forget by design — see server/resume.js. Awaiting the replays would hold
  // this job for the rest of the turn and push back its next tick.
  job: () => resumeStalledTurnsAsync(),
});

SyncedCron.add({
  name: 'Clean up abandoned games',
  schedule: (parser) => parser.text('every 1 minute'),
  job: async () => {
    const graceMs = bootGraceMs();
    if (Date.now() - bootedAtMs() < graceMs) {
      console.log(
        `Skipping abandoned-game check: the server booted less than ${Math.round(graceMs / 1000)}s ago`
      );
      return;
    }
    const liveGames = await Games.find({ started: true, winner: { $exists: false } }).fetchAsync();
    for (const game of liveGames) {
      const players = await Players.find({ gameId: game._id }).fetchAsync();
      const numPlayers = players.length;
      let playersOnline = 0;
      let lastManStanding = null;

      await Promise.all(
        players.map(async (player) => {
          const user = await Meteor.users.findOneAsync(player.userId);
          if (user && !user.status.online) {
            await delay(5000);
            const userRecheck = await Meteor.users.findOneAsync(player.userId);
            if (userRecheck && !userRecheck.status.online) {
              await player.chatAsync(`disconnected and left the game`);
            } else {
              lastManStanding = player;
              playersOnline++;
            }
          } else {
            lastManStanding = player;
            playersOnline++;
          }
        })
      );

      console.log(`Game ${game._id}: ${playersOnline} of ${numPlayers} players online.`);

      if (playersOnline === 0) {
        await endGame(game._id, null);
      } else if (playersOnline === 1 && game.min_player > 1) {
        // Only rebuild when the game really ended: a lost claim wrote no winner.
        if (await endGame(game._id, lastManStanding)) await buildHighscores();
      }
    }

    // clean up inactive users
    const inactiveThreshold = new Date();
    inactiveThreshold.setMinutes(inactiveThreshold.getMinutes() - 30);
    await Meteor.users.updateAsync(
      { 'status.lastActivity': { $lt: inactiveThreshold } },
      { $set: { 'status.online': false } },
      { multi: true }
    );
  },
});

// The account configuration that depends on Meteor.settings. The rest of the Accounts
// setup — the display name every user document carries and the write rules on
// Meteor.users — is in ./accounts.js.
Meteor.startup(async () => {
  markBooted();

  // Games created before resumable turns have no `step`, and `advanceAsync`'s selector can
  // never match a missing field — such a game would refuse every write in its turn chain.
  // Seed them first, before the cron jobs start and before a client can reach a method.
  const backfilled = await Games.updateAsync(
    { step: { $exists: false } },
    { $set: { step: 0, lastStepAt: null } },
    { multi: true }
  );
  if (backfilled > 0) console.log(`Backfilled step on ${backfilled} game(s)`);

  // A game whose turn died with the previous process is picked up here rather than at the
  // first cron tick — with the same stall threshold, which is what keeps a booting
  // instance off a game a still-running one is driving during a rolling deploy.
  await resumeStalledTurnsAsync();

  Accounts.config({
    ambiguousErrorMessages: false,
    sendVerificationEmail: Meteor.settings?.VERIFY_EMAILS || false,
  });

  Accounts.emailTemplates.siteName = 'RoboRally';
  if (Meteor.settings?.MAIL_FROM) {
    Accounts.emailTemplates.from = Meteor.settings.MAIL_FROM;
  }

  Accounts.validateNewUser((user) => {
    const email = user.emails?.[0]?.address;
    if (!email) return true;

    const allowedEmails = Meteor.settings?.ALLOWED_EMAILS || [];
    const allowedDomains = Meteor.settings?.ALLOWED_DOMAINS || [];

    if (allowedEmails.length === 0 && allowedDomains.length === 0) return true;

    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (
      allowedEmails.includes(email.toLowerCase()) ||
      allowedDomains.includes(domain.toLowerCase())
    ) {
      return true;
    }

    throw new Meteor.Error(403, "Email isn't allowed to register on this server.");
  });

  Accounts.validateLoginAttempt((attempt) => {
    if (!attempt.allowed) {
      return false;
    }

    if (Accounts._options.sendVerificationEmail) {
      const user = attempt.user;
      if (user.emails && !user.emails.some((email) => email.verified)) {
        throw new Meteor.Error(
          'email-not-verified',
          'You must verify your email address before logging in. Please check your inbox.'
        );
      }
    }

    return true;
  });

  console.info('Meteor.startup: cron');
  SyncedCron.start();
});

async function delay(ms) {
  return new Promise((resolve) => Meteor.setTimeout(resolve, ms));
}

// `player` is the last one standing, or null when nobody was left. Only a real winner
// gets a `winnerUserId` — its absence is what server/highscores.js reads as "no win here".
//
// Ending a game is a transition, so it takes the claim like every other write in the turn
// chain. That matters because the stalled-turn sweep will happily replay a segment for a
// game nobody is online for, and a PLAY replay runs ~30 s while this job ticks every
// minute — so a driver is often still inside the turn when this runs. As a plain update
// this left `step` alone, the driver's next claim still matched, and it wrote the game back
// to a live phase: ENDED and live at once, and never looked at again, because the query
// above filters on a missing `winner`.
//
// The game is re-read rather than passed in, because the caller's copy predates the
// five-second offline recheck and a stale `step` would lose a claim that should win.
// Returns whether the game was actually ended.
async function endGame(gameId, player) {
  const game = await Games.findOneAsync(gameId);
  if (!game) return false;

  const ended = await game.advanceAsync({
    $set: {
      gamePhase: GameState.PHASE.ENDED,
      winner: player ? player.name : 'Nobody',
      ...(player ? { winnerUserId: player.userId } : {}),
      stopped: Date.now(),
    },
  });

  if (ended) {
    console.log(`Ending abandoned game: ${gameId}`);
  } else {
    // Something moved the game between the read and the write. Leave it — this job runs
    // every minute and an abandoned game is still abandoned on the next tick.
    console.log(`Game ${gameId} moved while being ended; leaving it for the next tick`);
  }
  return ended;
}
