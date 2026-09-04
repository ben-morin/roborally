// @vitest-environment jsdom
// The accounts widget, one test per state the logged-out panel can be in. The server seam
// (client/views/accounts/accountsApi.ts) is mocked, so what is under test is the wiring:
// which call each form makes, what it does with the answer, and what the panel then says.
// The wording is the Blaze widget's, kept verbatim, so these strings are deliberately
// literal — a reworded message is a change users would notice.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AccountsMenu } from '../../client/views/accounts/AccountsMenu.tsx';
import {
  changePassword,
  createUser,
  forgotPassword,
  isEmailAvailable,
  loginWithPassword,
  logout,
  notice,
  resendVerificationEmail,
  resetPassword,
  resetToken,
} from '../../client/views/accounts/accountsApi.ts';
import { accountsHooks, loginAs, resetFakeCollections, setLoggingIn } from '../setup.js';

// The two ReactiveVars are mocked alongside the calls, and that is what makes the dialog
// tests readable: `get` says what the emailed link left behind, and `set` is the assertion
// that the dialog put the right thing back. Their reactivity is not under test — the
// react-meteor-data stub reads them on every render and nothing invalidates.
vi.mock('../../client/views/accounts/accountsApi.ts', () => ({
  loginWithPassword: vi.fn(),
  createUser: vi.fn(),
  forgotPassword: vi.fn(),
  logout: vi.fn(),
  isEmailAvailable: vi.fn(),
  resendVerificationEmail: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
  verifyEmail: vi.fn(),
  resetToken: { get: vi.fn(() => null), set: vi.fn() },
  notice: { get: vi.fn(() => null), set: vi.fn() },
}));

const EMAIL = 'ben@example.com';
const PASSWORD = 'a-good-password';
const ACCOUNT_CREATED =
  'Account created! Please check your inbox and verify your email before logging in.';

const unverified = () => new Meteor.Error('email-not-verified', 'Email not verified');

/** Render the widget with something outside it to click, and open the panel. */
async function openPanel() {
  render(
    <div>
      <AccountsMenu />
      <button type="button">elsewhere</button>
    </div>
  );
  await userEvent.click(screen.getByRole('link', { name: 'Sign in' }));
}

/** The sign-in form, filled but not submitted. */
async function fillCredentials(email = EMAIL, password = PASSWORD) {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
}

const submitButton = () => screen.getByRole('button', { name: /Sign in|Create account|Reset/ });

beforeEach(() => {
  resetFakeCollections();
  vi.mocked(loginWithPassword).mockResolvedValue(undefined);
  vi.mocked(createUser).mockResolvedValue(undefined);
  vi.mocked(forgotPassword).mockResolvedValue(undefined);
  vi.mocked(resendVerificationEmail).mockResolvedValue(undefined);
  vi.mocked(isEmailAvailable).mockResolvedValue(true);
  vi.mocked(resetPassword).mockResolvedValue(undefined);
  vi.mocked(changePassword).mockResolvedValue(undefined);
  vi.mocked(resetToken.get).mockReturnValue(null);
  vi.mocked(notice.get).mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountsMenu, logged out', () => {
  it('shows only the sign-in link until it is clicked', () => {
    render(<AccountsMenu />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('opens the panel on the sign-in form', async () => {
    await openPanel();

    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(submitButton()).toHaveTextContent('Sign in');
  });

  it('shows a spinner instead of the link while a login is in flight', () => {
    setLoggingIn(true);
    render(<AccountsMenu />);

    expect(screen.getByText('Signing in')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('AccountsMenu sign-in', () => {
  it('refuses an address with no @ without asking the server', async () => {
    await openPanel();
    await fillCredentials('ben');
    await userEvent.click(submitButton());

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email');
    expect(loginWithPassword).not.toHaveBeenCalled();
  });

  it('refuses a password under six characters without asking the server', async () => {
    await openPanel();
    await fillCredentials(EMAIL, '12345');
    await userEvent.click(submitButton());

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Password must be at least 6 characters long'
    );
    expect(loginWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with the address and password typed', async () => {
    await openPanel();
    await fillCredentials();
    await userEvent.click(submitButton());

    expect(loginWithPassword).toHaveBeenCalledWith(EMAIL, PASSWORD);
  });

  it('shows the reason the server gave', async () => {
    vi.mocked(loginWithPassword).mockRejectedValue(new Meteor.Error(403, 'Incorrect password'));
    await openPanel();
    await fillCredentials();
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password');
  });
});

describe('AccountsMenu email verification', () => {
  // Reaches the state the Resend button belongs to: a sign-in the server refused because
  // the address has never been verified.
  async function refusedAsUnverified() {
    vi.mocked(loginWithPassword).mockRejectedValue(unverified());
    await openPanel();
    await fillCredentials();
    await userEvent.click(submitButton());
    await screen.findByRole('alert');
  }

  it('offers Resend when the address is unverified', async () => {
    await refusedAsUnverified();

    expect(screen.getByRole('alert')).toHaveTextContent('Email not verified');
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });

  it('resends the verification email to the address on screen', async () => {
    await refusedAsUnverified();
    await userEvent.click(screen.getByRole('button', { name: 'Resend' }));

    expect(resendVerificationEmail).toHaveBeenCalledWith({ email: EMAIL });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Verification email sent! Please check your inbox.'
    );
  });

  it('keeps the button when Resend has no address to send to', async () => {
    await refusedAsUnverified();
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.click(screen.getByRole('button', { name: 'Resend' }));

    expect(resendVerificationEmail).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your email address.');
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });
});

describe('AccountsMenu sign-up', () => {
  it('keeps the typed address on the way to Create account', async () => {
    await openPanel();
    await fillCredentials();
    await userEvent.click(screen.getByRole('link', { name: 'Create account' }));

    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL);
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(submitButton()).toHaveTextContent('Create account');
  });

  it('creates the account the form describes', async () => {
    await openPanel();
    await userEvent.click(screen.getByRole('link', { name: 'Create account' }));
    await fillCredentials();
    await userEvent.click(submitButton());

    expect(createUser).toHaveBeenCalledWith(EMAIL, PASSWORD);
  });

  it('lands back on sign-in with the account-created notice and no password', async () => {
    vi.mocked(createUser).mockRejectedValue(unverified());
    await openPanel();
    await userEvent.click(screen.getByRole('link', { name: 'Create account' }));
    await fillCredentials();
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_CREATED);
    expect(submitButton()).toHaveTextContent('Sign in');
    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL);
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });

  it('shows the reason for any other sign-up failure', async () => {
    vi.mocked(createUser).mockRejectedValue(new Meteor.Error(403, 'Email already exists.'));
    await openPanel();
    await userEvent.click(screen.getByRole('link', { name: 'Create account' }));
    await fillCredentials();
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already exists.');
    expect(submitButton()).toHaveTextContent('Create account');
  });
});

describe('AccountsMenu forgot password', () => {
  async function forgotForm() {
    await openPanel();
    await fillCredentials();
    await userEvent.click(screen.getByRole('link', { name: 'Forgot password' }));
  }

  it('asks for the address alone, prefilled from the sign-in form', async () => {
    await forgotForm();

    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(submitButton()).toHaveTextContent('Reset password');
  });

  it('says so when the deployment cannot send mail', async () => {
    vi.mocked(isEmailAvailable).mockResolvedValue(false);
    await forgotForm();
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Password reset is unavailable.');
    expect(forgotPassword).not.toHaveBeenCalled();
  });

  it('sends the reset email and returns to sign-in', async () => {
    await forgotForm();
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Email sent');
    expect(forgotPassword).toHaveBeenCalledWith(EMAIL);
    expect(submitButton()).toHaveTextContent('Sign in');
  });
});

describe('AccountsMenu dismissal', () => {
  it('closes on Escape', async () => {
    await openPanel();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('closes on a click outside the panel', async () => {
    await openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('stays open while the panel itself is being used', async () => {
    await openPanel();
    await userEvent.click(screen.getByLabelText('Email'));

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});

describe('AccountsMenu, logged in', () => {
  // The display name is what the rest of the app uses (both/permissions.ts), not the
  // address: profile.name when the server stored one, the local part otherwise.
  async function signedIn(user: Partial<Meteor.User> = { profile: { name: 'ben' } }) {
    await loginAs(user);
    render(<AccountsMenu />);
  }

  it('shows the display name in place of the sign-in link', async () => {
    await signedIn();

    const link = screen.getByRole('link', { name: 'ben' });
    expect(link).toHaveAttribute('id', 'login-name-link');
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('falls back to the local part of the address with no stored name', async () => {
    await signedIn({ emails: [{ address: 'Ben@Example.com', verified: true }] });

    expect(screen.getByRole('link', { name: 'ben' })).toBeInTheDocument();
  });

  it('opens the user menu rather than the sign-in form', async () => {
    await signedIn();
    await userEvent.click(screen.getByRole('link', { name: 'ben' }));

    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('signs out', async () => {
    await signedIn();
    await userEvent.click(screen.getByRole('link', { name: 'ben' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(logout).toHaveBeenCalled();
  });
});

describe('AccountsMenu change password', () => {
  async function changeForm() {
    await loginAs({ profile: { name: 'ben' } });
    render(<AccountsMenu />);
    await userEvent.click(screen.getByRole('link', { name: 'ben' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
  }

  const fill = async (current: string, next: string) => {
    await userEvent.type(screen.getByLabelText('Current password'), current);
    await userEvent.type(screen.getByLabelText('New password'), next);
  };

  it('refuses a new password under six characters without asking the server', async () => {
    await changeForm();
    await fill('old-password', '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Password must be at least 6 characters long'
    );
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('changes the password and says so', async () => {
    await changeForm();
    await fill('old-password', 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(changePassword).toHaveBeenCalledWith('old-password', 'new-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Password changed');
    // mode: 'message' — the form is gone and only the line is left.
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('shows the reason the server gave', async () => {
    vi.mocked(changePassword).mockRejectedValue(new Meteor.Error(403, 'Incorrect password'));
    await changeForm();
    await fill('wrong-password', 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password');
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });
});

describe('ResetPasswordDialog', () => {
  let done: Mock<() => void>;

  beforeEach(() => {
    done = vi.fn<() => void>();
    vi.mocked(resetToken.get).mockReturnValue({ token: 'reset-token', done });
  });

  it('asks for a new password as soon as the link is followed', () => {
    render(<AccountsMenu />);

    expect(screen.getByRole('dialog', { name: 'Reset password' })).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
  });

  it('refuses a short password without spending the token', async () => {
    render(<AccountsMenu />);
    await userEvent.type(screen.getByLabelText('New password'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Password must be at least 6 characters long'
    );
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('resets the password, releases the token and raises the notice', async () => {
    render(<AccountsMenu />);
    await userEvent.type(screen.getByLabelText('New password'), 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(resetPassword).toHaveBeenCalledWith('reset-token', 'new-password');
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(resetToken.set).toHaveBeenCalledWith(null);
    expect(notice.set).toHaveBeenCalledWith({ kind: 'reset' });
  });

  it('shows the reason the server gave and keeps the dialog', async () => {
    vi.mocked(resetPassword).mockRejectedValue(new Meteor.Error(403, 'Token expired'));
    render(<AccountsMenu />);
    await userEvent.type(screen.getByLabelText('New password'), 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Token expired');
    expect(notice.set).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it('releases the token when the dialog is closed unused', async () => {
    render(<AccountsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(done).toHaveBeenCalled();
    expect(resetToken.set).toHaveBeenCalledWith(null);
    expect(resetPassword).not.toHaveBeenCalled();
  });
});

describe('NoticeDialog', () => {
  it.each([
    ['verified' as const, 'Email verified'],
    ['reset' as const, 'Password reset'],
  ])('names who the %s link logged in', async (kind, heading) => {
    await loginAs({ profile: { name: 'ben' } });
    vi.mocked(notice.get).mockReturnValue({ kind });
    render(<AccountsMenu />);

    const dialog = screen.getByRole('dialog', { name: heading });
    expect(dialog).toHaveTextContent(heading);
    expect(dialog).toHaveTextContent('You are now logged in as: ben');
  });

  it('shows what went wrong instead', () => {
    vi.mocked(notice.get).mockReturnValue({ kind: 'error', message: 'Verify link expired' });
    render(<AccountsMenu />);

    expect(screen.getByRole('alert')).toHaveTextContent('Verify link expired');
  });

  it('clears the notice on Dismiss', async () => {
    vi.mocked(notice.get).mockReturnValue({ kind: 'verified' });
    render(<AccountsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(notice.set).toHaveBeenCalledWith(null);
  });
});

// The one test that loads the real module: the registrations are its whole point, and a
// mock would prove nothing about them.
describe('accountsApi link registration', () => {
  it('registers both URL-token callbacks as it loads', async () => {
    const api = await vi.importActual<typeof import('../../client/views/accounts/accountsApi.ts')>(
      '../../client/views/accounts/accountsApi.ts'
    );
    const hooks = accountsHooks();

    expect(hooks.resetPasswordLink).toHaveLength(1);
    expect(hooks.emailVerificationLink).toHaveLength(1);

    // And the reset one really does park the token where the dialog reads it.
    const done = vi.fn<() => void>();
    hooks.resetPasswordLink[0]('url-token', done);
    expect(api.resetToken.get()).toEqual({ token: 'url-token', done });
  });
});
