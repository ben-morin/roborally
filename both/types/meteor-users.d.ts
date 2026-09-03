// What other packages write into Meteor.users and this app reads. @types/meteor leaves
// `UserProfile` empty on purpose and knows nothing about mizzao:user-status.
declare namespace Meteor {
  interface UserProfile {
    // The display name server/accounts.ts stores at sign-up; the one field the
    // `onlineUsers` publication sends about other people.
    name?: string;
  }
  interface User {
    // Presence, written by mizzao:user-status. `lastLogin` never leaves the server.
    status?: {
      online: boolean;
      idle?: boolean;
      lastLogin?: { date: Date; ipAddr: string; userAgent: string };
    };
  }
}

declare namespace Accounts {
  // Private, but the email-verification login gate in server/cron.ts reads it.
  const _options: { sendVerificationEmail?: boolean };
}
