// This file is the server entry point (`meteor.mainModule`), so it pulls in the rest of
// the server. The side-effect imports are the files nothing else imports; `logging.js`
// comes first so it can silence `console.log` in production before anything runs. Every
// other model and collection loads transitively through these.
import { checkReactivity } from './mongoReactivity.js';
import '../both/logging.js';
import '../both/cardMethods.js';
import '../collections/users.js';

import { SyncedCron } from 'meteor/quave:synced-cron';
import { autoSubmitIfTimedOut } from '../both/cardlogic.js';
import { GameLogic } from '../both/gamelogic.js';
import { GameState } from '../both/gamestate.js';
import { Games } from '../collections/games.js';
import { Players } from '../collections/players.js';
import { buildHighscores } from './highscores.js';
import './accounts.js';
import './methods.js';
import './publications.js';
import './rateLimits.js';

Meteor.settings = Meteor.settings || {};
Meteor.settings.public = Meteor.settings.public || {};
Meteor.settings.public.appVersion =
  process.env.APP_VERSION || process.env.npm_package_version || 'development';

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
    // Only the program phase is swept. A game stuck part-way through the play phase is
    // a different problem and is NOT safe to re-drive: those phases consume cards and
    // move robots as they go, so re-entering one could apply a turn twice.
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
  },
});

SyncedCron.add({
  name: 'Clean up abandoned games',
  schedule: (parser) => parser.text('every 1 minute'),
  job: async () => {
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
        await endGame(game._id, 'Nobody');
      } else if (playersOnline === 1 && game.min_player > 1) {
        await endGame(game._id, lastManStanding.name);
        await buildHighscores();
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
Meteor.startup(() => {
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

  checkReactivity();
});

async function delay(ms) {
  return new Promise((resolve) => Meteor.setTimeout(resolve, ms));
}

async function endGame(gameId, winner) {
  console.log(`Ending abandoned game: ${gameId}`);
  await Games.updateAsync(gameId, {
    $set: {
      gamePhase: GameState.PHASE.ENDED,
      winner,
      stopped: Date.now(),
    },
  });
}
