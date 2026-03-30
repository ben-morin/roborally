SyncedCron.config({ log: false });

SyncedCron.add({
  name: 'Build highscore lists',
  schedule: (parser) => parser.text('every 1 hour'),
  job: async () => {
    console.log("CRON: Building highscore lists");
    await buildHighscores();
  }
});

SyncedCron.add({
  name: 'Clean up unstarted games',
  schedule: (parser) => parser.text('every 5 minutes'),
  job: async () => {

    const openGames = await Games.find({started: false}).fetchAsync();
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
  }
});

SyncedCron.add({
  name: 'Clean up abandoned games',
  schedule: (parser) => parser.text('every 1 minute'),
  job: async () => {

    const liveGames = await Games.find({ started: true, winner: { $exists: false } }).fetchAsync();
    for (const game of liveGames) {
      const players = await Players.find({ gameId: game._id }).fetchAsync();
      let numPlayers = players.length;
      let playersOnline = 0;
      let lastManStanding = null;

      await Promise.all(players.map(async (player) => {
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
      }));

      console.log(`Game ${game._id}: ${playersOnline} of ${numPlayers} players online.`);

      if (playersOnline === 0) {
        await endGame(game._id, "Nobody");
      } else if (playersOnline === 1 && game.min_player > 1) {
        await endGame(game._id, lastManStanding.name);
        await buildHighscores();
      }
    }

    // clean up inactive users
    const inactiveThreshold = new Date();
    inactiveThreshold.setMinutes(inactiveThreshold.getMinutes() - 30);
    await Meteor.users.updateAsync(
      { "status.lastActivity": { $lt: inactiveThreshold } },
      { $set: { "status.online": false } },
      { multi: true }
    );
  }
});

Meteor.startup(() => {
  Accounts.config({
    ambiguousErrorMessages: false,
    sendVerificationEmail: Meteor.settings?.VERIFY_EMAILS || false,
  });

  Accounts.emailTemplates.siteName = "RoboRally";
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
    if (allowedEmails.includes(email.toLowerCase()) || allowedDomains.includes(domain.toLowerCase())) {
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
      if (user.emails && !user.emails.some(email => email.verified)) {
        throw new Meteor.Error('email-not-verified', 'You must verify your email address before logging in. Please check your inbox.');
      }
    }

    return true;
  });

  console.info("Meteor.startup: cron");
  SyncedCron.start();
});

async function delay(ms) {
  return new Promise(resolve => Meteor.setTimeout(resolve, ms));
}

async function endGame(gameId, winner) {
  console.log(`Ending abandoned game: ${gameId}`);
  await Games.updateAsync(gameId, {
    $set: {
      gamePhase: GameState.PHASE.ENDED,
      winner,
      stopped: Date.now()
    }
  });
}
