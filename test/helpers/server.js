// Boots the server the way Meteor does: server/cron.js is the `meteor.mainModule` entry
// point, so importing it pulls in methods, publications, highscores, the collections and
// the cron jobs through the same side-effect imports production uses. Test files import
// this for its side effects only.
//
// Doing it through the real entry point rather than importing the method modules directly
// means the suite also covers load order — the thing the entry point's comment block is
// about (logging first, easySchemaConfig ahead of any collection).
//
// Meteor.startup callbacks are captured, not run; call runStartup() from test/setup.js
// when a test needs the Accounts configuration.
import '../../server/cron.js';
