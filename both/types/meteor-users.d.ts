// What other packages write into Meteor.users and this app reads. @types/meteor leaves
// `UserProfile` empty on purpose and knows nothing about mizzao:user-status.
declare namespace Meteor {
  interface UserProfile {
    // The display name server/accounts.ts stores at sign-up; the one field the
    // `onlineUsers` publication sends about other people.
    name?: string;
  }
  interface User {
    // Presence, written by mizzao:user-status. Of `lastLogin`, only the date ever leaves the
    // server, and only to an admin.
    status?: {
      online: boolean;
      idle?: boolean;
      lastLogin?: { date: Date; ipAddr: string; userAgent: string };
    };
  }
}

declare namespace Accounts {
  // Private, but the email-verification login gate in server/accounts.ts reads it.
  const _options: { sendVerificationEmail?: boolean };
  // Private: accounts-password's own check of a plain-text password against the stored hash,
  // resolving with `error` set on a mismatch. A user's own email change asks for it.
  function _checkPasswordAsync(
    user: Meteor.User,
    password: string
  ): Promise<{ userId: string; error?: Meteor.Error }>;
  // accounts-password 3.x; @types/meteor predates it. The admin edit and a user's own email
  // change use it, so the duplicate-address check stays Meteor's.
  function replaceEmailAsync(
    userId: string,
    oldEmail: string,
    newEmail: string,
    verified?: boolean
  ): Promise<void>;
}
