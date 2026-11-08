// The user manager's Add user form, in the right column in place of a user. With no
// password the server emails the existing password-reset link, so the new user picks their
// own; that needs mail, so without it a password is required.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { adminCreateUser } from '../../../both/methods/admin.ts';
import { modalAlert } from '../../helper/modalDialogs.ts';

const EYEBROW = 'mb-2 block text-xs font-semibold tracking-[.08em] text-muted uppercase';
const INPUT =
  'block h-10 w-full rounded-control border border-white/16 bg-raised px-3 text-sm text-white placeholder:text-muted focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const NOTE = 'mt-2 mb-0 text-xs text-muted';
const BTN =
  'inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-control px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PRIMARY = `${BTN} border-0 bg-brand text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)]`;
const GHOST = `${BTN} border border-white/22 bg-transparent text-white hover:border-white/40 hover:bg-raised`;

export interface AddUserFormProps {
  mailAvailable: boolean;
  onCreated: (userId: string) => void;
  onCancel: () => void;
}

export function AddUserForm({ mailAvailable, onCreated, onCancel }: AddUserFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verified, setVerified] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    // The server refuses this too; saying it here spares a round trip.
    if (!password && !mailAvailable) {
      modalAlert('Email is not set up on this server. Type a password instead.');
      return;
    }
    adminCreateUser({ email, password, verified }).then(
      (userId) => {
        onCreated(userId);
        return modalAlert(
          password
            ? `${email.trim()} can sign in now.`
            : `A password reset email is on its way to ${email.trim()}, to choose a password.`
        );
      },
      (error: { reason?: string }) => modalAlert(error.reason ?? 'Something went wrong.')
    );
  };

  return (
    <form className="text-left" onSubmit={onSubmit} aria-label="Add user">
      <h2 className="mt-0 mb-0 text-center">
        <span className={EYEBROW}>New user</span>
        <span className="block text-2xl">Add user</span>
      </h2>
      <hr className="star-well mt-3 mb-7" />

      <label className={EYEBROW} htmlFor="admin-new-email">
        Email
      </label>
      <input
        id="admin-new-email"
        type="email"
        required
        className={INPUT}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <label className={`${EYEBROW} mt-4`} htmlFor="admin-new-password">
        Password
      </label>
      <input
        id="admin-new-password"
        type="password"
        autoComplete="new-password"
        required={!mailAvailable}
        className={INPUT}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <p className={NOTE}>
        {mailAvailable
          ? 'Leave it empty to email them a link to choose their own.'
          : 'Email is not set up on this server, so a password is needed.'}
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={verified}
          onChange={(event) => setVerified(event.target.checked)}
        />
        Email verified
      </label>

      <div className="mt-5 space-y-3">
        <button type="submit" className={PRIMARY}>
          Create
        </button>
        <button type="button" className={GHOST} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
