// The user manager's right-hand panel: one account, and everything an admin can do to it.
// Every action is its own admin method, and every answer — done or refused — is a modal,
// as everywhere else in the app, except a done Save or Delete: the list shows the result
// (the row changes, or leaves), so only a refusal needs saying. The server checks each one
// again; what this hides is only what the server would refuse.
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  adminDeleteUser,
  adminLogoutUser,
  adminSendResetEmail,
  adminSendVerificationEmail,
  adminSetPassword,
  adminUpdateUser,
} from '../../../both/methods/admin.ts';
import { getUsername } from '../../../both/permissions.ts';
import { modalAlert, modalConfirm } from '../../helper/modalDialogs.ts';
import { primaryEmail } from '../../lib/adminUsers.ts';
import type { AdminUserDoc } from '../../lib/adminUsers.ts';

const EYEBROW = 'mb-2 block text-xs font-semibold tracking-[.08em] text-muted uppercase';
const SECTION = 'mt-7 text-left';
const INPUT =
  'block h-10 w-full rounded-control border border-white/16 bg-raised px-3 text-sm text-white placeholder:text-muted focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const NOTE = 'mt-2 mb-0 text-xs text-muted';
const BTN =
  'inline-flex h-10 w-full items-center justify-center rounded-control px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PRIMARY = `${BTN} cursor-pointer border-0 bg-brand text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)]`;
const GHOST = `${BTN} cursor-pointer border border-white/22 bg-transparent text-white hover:border-white/40 hover:bg-raised`;
const GHOST_OFF = `${BTN} cursor-not-allowed border border-white/22 bg-transparent text-white opacity-45`;
const DANGER = `${BTN} cursor-pointer border-0 bg-danger text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_88%,white)]`;

export interface UserDetailProps {
  user: AdminUserDoc;
  /** From `adminAccountIds`: an admin account is never offered Delete. */
  isAdmin: boolean;
  isSelf: boolean;
  mailAvailable: boolean;
  /** After an edit, which can move an address on to the admin list or off it. */
  onChanged: () => void;
  onDeleted: () => void;
}

// The modal is the whole report, so a refusal is shown as the server worded it.
const report = (error: { reason?: string }) => modalAlert(error.reason ?? 'Something went wrong.');

export function UserDetail({
  user,
  isAdmin,
  isSelf,
  mailAvailable,
  onChanged,
  onDeleted,
}: UserDetailProps) {
  const email = primaryEmail(user);
  const name = getUsername(user);
  const [nameField, setNameField] = useState(user.profile?.name ?? '');
  const [emailField, setEmailField] = useState(email?.address ?? '');
  const [verified, setVerified] = useState(email?.verified ?? false);
  const [password, setPassword] = useState('');

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    adminUpdateUser({ userId: user._id, name: nameField, email: emailField, verified }).then(
      onChanged,
      report
    );
  };

  const onSetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (isSelf && !(await modalConfirm('This signs you out everywhere, this browser too.'))) {
      return;
    }
    adminSetPassword({ userId: user._id, password }).then(() => {
      setPassword('');
      return modalAlert(`Password set. ${name} is signed out everywhere.`);
    }, report);
  };

  const onSendReset = () =>
    adminSendResetEmail({ userId: user._id }).then(
      () => modalAlert(`A password reset email is on its way to ${email?.address}.`),
      report
    );

  const onSendVerification = () =>
    adminSendVerificationEmail({ userId: user._id }).then(
      () => modalAlert(`A verification email is on its way to ${email?.address}.`),
      report
    );

  const onSignOut = async () => {
    const question = isSelf
      ? 'Sign yourself out everywhere, this browser too?'
      : `Sign ${name} out everywhere?`;
    if (!(await modalConfirm(question))) return;
    adminLogoutUser({ userId: user._id }).then(
      () => modalAlert(`${name} is signed out everywhere.`),
      report
    );
  };

  const onDelete = async () => {
    const question = `Delete ${name}? Their finished games and their rankings stay. This cannot be undone.`;
    if (!(await modalConfirm(question))) return;
    adminDeleteUser({ userId: user._id }).then(onDeleted, report);
  };

  return (
    <div className="text-left">
      <h2 className="mt-0 mb-0 text-center">
        <span className={EYEBROW}>{isSelf ? 'User — you' : 'User'}</span>
        <span className="block truncate text-2xl">{name}</span>
      </h2>
      <hr className="star-well mt-3 mb-2" />

      <form className={SECTION} onSubmit={onSave} aria-label="Details">
        <label className={EYEBROW} htmlFor="admin-user-name">
          Name
        </label>
        <input
          id="admin-user-name"
          className={INPUT}
          value={nameField}
          onChange={(event) => setNameField(event.target.value)}
        />
        <label className={`${EYEBROW} mt-4`} htmlFor="admin-user-email">
          Email
        </label>
        <input
          id="admin-user-email"
          type="email"
          className={INPUT}
          value={emailField}
          onChange={(event) => setEmailField(event.target.value)}
        />
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={verified}
            onChange={(event) => setVerified(event.target.checked)}
          />
          Email verified
        </label>
        <button type="submit" className={`${PRIMARY} mt-4`}>
          Save
        </button>
      </form>

      <form className={SECTION} onSubmit={onSetPassword} aria-label="Password">
        <label className={EYEBROW} htmlFor="admin-user-password">
          New password
        </label>
        <input
          id="admin-user-password"
          type="password"
          autoComplete="new-password"
          className={INPUT}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className={`${GHOST} mt-3`}>
          Set password
        </button>
        <p className={NOTE}>Setting a password signs the user out everywhere.</p>
      </form>

      <div className={SECTION}>
        <span className={EYEBROW}>Email</span>
        <div className="space-y-3">
          {mailAvailable ? (
            <button type="button" className={GHOST} onClick={onSendReset}>
              Send password reset email
            </button>
          ) : (
            <button type="button" className={GHOST_OFF} disabled>
              Send password reset email
            </button>
          )}
          {email && !email.verified && mailAvailable && (
            <button type="button" className={GHOST} onClick={onSendVerification}>
              Send verification email
            </button>
          )}
        </div>
        {!mailAvailable && <p className={NOTE}>Email is not set up on this server.</p>}
      </div>

      <div className={SECTION}>
        <span className={EYEBROW}>Account</span>
        <div className="space-y-3">
          <button type="button" className={GHOST} onClick={onSignOut}>
            Sign out everywhere
          </button>
          {!isAdmin && (
            <button type="button" className={DANGER} onClick={onDelete}>
              Delete user
            </button>
          )}
        </div>
        {isAdmin && (
          <p className={NOTE}>
            {isSelf
              ? 'You cannot delete your own account.'
              : 'An admin cannot be deleted. Remove the address from ADMIN_EMAILS first.'}
          </p>
        )}
      </div>
    </div>
  );
}
