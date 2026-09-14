// This file is the server entry point (`meteor.mainModule`), so it pulls in the rest of
// the server. The side-effect imports are the files nothing else imports; `logging.ts`
// comes first so it can silence `console.log` in production before anything runs. Every
// other model and collection loads transitively through these.
import '../both/logging.ts';
// Before anything that reaches a collection: a schema is attached in the collection's
// module body, and it reads this configuration as it goes. See both/easySchemaConfig.ts.
import '../both/easySchemaConfig.ts';
// Same rule, for the same reason: jam:method reads this configuration when a method module
// runs `createMethod`. See both/methods/config.ts.
import '../both/methods/config.ts';
import '../both/methods/accounts.ts';
import '../both/methods/cards.ts';
import '../both/methods/chat.ts';
import '../both/methods/games.ts';
import '../collections/users.ts';

import { backfillAsync } from './backfill.ts';
import { markBooted } from './boot.ts';
import { startCron } from './cron.ts';
import { buildHighscores } from './highscores.ts';
import { resumeStalledTurnsAsync } from './resume.ts';
import './accounts.ts';
import './publications.ts';

Meteor.settings = Meteor.settings || {};
Meteor.settings.public = Meteor.settings.public || {};
Meteor.settings.public.appVersion =
  process.env.APP_VERSION || process.env.npm_package_version || 'development';

// The account configuration that depends on Meteor.settings. The rest of the Accounts
// setup — the display name every user document carries and the write rules on
// Meteor.users — is in ./accounts.ts.
Meteor.startup(async () => {
  markBooted();

  // Repairs to documents already in the database, before the cron jobs start and before a
  // client can reach a method. A game without `step` would refuse every claim its turn
  // chain makes, so this cannot wait for a tick. See server/backfill.ts.
  await backfillAsync();
  // After the backfills: the most-won list groups on `winnerUserId`, which they fill in.
  await buildHighscores();

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

  Accounts.validateNewUser((user: Meteor.User) => {
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

  Accounts.validateLoginAttempt((attempt: { allowed: boolean; user?: Meteor.User }) => {
    if (!attempt.allowed) {
      return false;
    }

    if (Accounts._options.sendVerificationEmail) {
      // An allowed attempt always carries the user it authenticated; only a rejected one
      // can be without, and those returned above.
      const user = attempt.user!;
      if (user.emails && !user.emails.some((email) => email.verified)) {
        throw new Meteor.Error(
          'email-not-verified',
          'You must verify your email address before logging in. Please check your inbox.'
        );
      }
    }

    return true;
  });

  console.info('Meteor.startup: main');
  startCron();
});
