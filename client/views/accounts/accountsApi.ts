// The one module that touches the callback-style Meteor and Accounts APIs. Everything the
// accounts component says to the server goes through here, promisified, so the component
// is one `vi.mock` away from being drivable without Meteor.
//
// A rejection carries the error object untouched: `describeError` in
// client/lib/accounts.ts reads `.error` and `.reason` off it, and wrapping would lose the
// code that decides whether the Resend button belongs on screen.

import { describeError } from '../../lib/accounts.ts';

// The two account methods, imported like every other view imports its methods and
// re-exported so the component has a single "talks to the server" import. Both are
// `serverOnly` through both/methods/config.ts, so the browser registers no stub for them.
export { isEmailAvailable, resendVerificationEmail } from '../../../both/methods/accounts.ts';

// A Meteor callback reports failure through its single argument; anything falsy is success.
type Done = (error?: unknown) => void;

const promisify = (call: (done: Done) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    call((error) => (error ? reject(error) : resolve()));
  });

export const loginWithPassword = (email: string, password: string) =>
  promisify((done) => Meteor.loginWithPassword({ email }, password, done));

export const createUser = (email: string, password: string) =>
  promisify((done) => Accounts.createUser({ email, password }, done));

export const forgotPassword = (email: string) =>
  promisify((done) => Accounts.forgotPassword({ email }, done));

export const logout = () => promisify((done) => Meteor.logout(done));

export const resetPassword = (token: string, password: string) =>
  promisify((done) => Accounts.resetPassword(token, password, done));

export const changePassword = (oldPassword: string, newPassword: string) =>
  promisify((done) => Accounts.changePassword(oldPassword, newPassword, done));

export const verifyEmail = (token: string) =>
  promisify((done) => Accounts.verifyEmail(token, done));

/** What a reset-password link hands over: the token from the URL, and the callback that
 * lets accounts-base carry on once the dialog is finished with it. */
export interface ResetRequest {
  token: string;
  done: () => void;
}

/** The one-shot dialog the two URL-token flows raise when they are done. */
export type Notice = { kind: 'verified' } | { kind: 'reset' } | { kind: 'error'; message: string };

export const resetToken = new ReactiveVar<ResetRequest | null>(null);
export const notice = new ReactiveVar<Notice | null>(null);

// The two registrations below are at module scope, and they have to be: accounts-base
// parses the URL hash as it loads and invokes whatever callback is registered by the time
// its own Meteor.startup runs, once. A registration from a useEffect is always too late,
// and the token is gone with it. The `ReactiveVar`s above exist so the component can read
// what they captured without being on screen when the link was followed.
//
// The third of accounts-base's link callbacks, the enrollment one, is deliberately absent:
// nothing in this app ever calls `Accounts.sendEnrollmentEmail`, so there is no such link
// to land on.
Accounts.onResetPasswordLink((token: string, done: () => void) => {
  resetToken.set({ token, done });
});

Accounts.onEmailVerificationLink((token: string, done: () => void) =>
  verifyEmail(token)
    .then(
      () => notice.set({ kind: 'verified' }),
      (error: unknown) => notice.set({ kind: 'error', message: describeError(error).message })
    )
    .finally(done)
);
