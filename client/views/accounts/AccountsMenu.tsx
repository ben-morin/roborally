// The navbar's accounts widget: the "Sign in" link or the display name, the panel that
// drops out of it, and the two dialogs the emailed links raise. It replaces a Blaze
// widget whose flows and wording this mirrors — the messages are the ones users have been
// reading for years, so they are kept verbatim.
//
// The panel is opened by React state and dismissed by hand (outside click, Escape); the
// dialogs are fixed overlays of the panel's own making.
import { useEffect, useReducer, useRef, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import {
  describeError,
  initialPanel,
  panelReducer,
  validateEmail,
  validatePassword,
} from '../../lib/accounts.ts';
import type { Panel, PanelAction } from '../../lib/accounts.ts';
import { getUsername } from '../../../both/permissions.ts';
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
} from './accountsApi.ts';
import type { Notice, ResetRequest } from './accountsApi.ts';

const ACCOUNT_CREATED =
  'Account created! Please check your inbox and verify your email before logging in.';

// The panel sits in the navbar's uppercase display-font list, so it resets all of that.
const PANEL =
  'absolute top-[calc(100%+10px)] right-0 z-20 w-[320px] rounded-panel border border-line bg-navy-deep p-5 text-left font-sans text-base font-normal tracking-normal normal-case shadow-[0_24px_60px_-24px_rgba(0,0,0,.7)]';
const LABEL = 'mb-2 block text-xs font-semibold tracking-[.08em] text-muted uppercase';
const INPUT =
  'block h-9 w-full rounded-control border border-white/16 bg-raised px-2.5 text-sm text-white placeholder:text-muted focus:border-teal';
const BTN =
  'inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-control px-3 text-sm font-semibold';
const PRIMARY = `${BTN} border-0 bg-brand text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)]`;
const GHOST = `${BTN} border border-white/22 bg-transparent text-white hover:border-white/40 hover:bg-raised`;
// The same row as the navbar's Games and Ranking links; the journey pins its 40px height.
const TOGGLE =
  'inline-flex h-10 items-center rounded-control px-3 font-display text-sm font-bold tracking-[.08em] uppercase no-underline';
const FOOTNOTE =
  'text-xs font-bold tracking-[.04em] text-teal uppercase whitespace-nowrap hover:text-white';
// Same reset as the panel: a dialog is rendered from inside the navbar item too.
const DIALOG =
  'w-[480px] max-w-[calc(100%-32px)] rounded-panel border border-line bg-navy-deep p-6 text-left font-sans text-base leading-normal font-normal tracking-normal normal-case shadow-[0_24px_60px_-24px_rgba(0,0,0,.8)]';

interface PanelProps {
  panel: Panel;
  dispatch: Dispatch<PanelAction>;
}

// Above the buttons and centred, which is where the widget this replaces put it. Every
// panel state renders it in that one spot rather than the container doing it once.
function Messages({ panel }: { panel: Panel }) {
  if (!panel.error && !panel.info) return null;
  return (
    <div
      role="alert"
      className={`mt-3 text-center text-sm ${panel.error ? 'text-error' : 'text-teal'}`}
    >
      {panel.error ?? panel.info}
    </div>
  );
}

function SignInPanel({ panel, dispatch }: PanelProps) {
  // Here rather than in the fields, so the address survives a switch between sign-in,
  // sign-up and forgot-password — which is what the package's Tracker.flush()-and-copy
  // dance existed to do.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signIn = async () => {
    const invalid = validateEmail(email) ?? validatePassword(password);
    if (invalid) {
      dispatch({ type: 'error', message: invalid });
      return;
    }
    try {
      await loginWithPassword(email, password);
    } catch (error) {
      dispatch({ type: 'error', ...describeError(error) });
    }
  };

  const signUp = async () => {
    const invalid = validateEmail(email) ?? validatePassword(password);
    if (invalid) {
      dispatch({ type: 'error', message: invalid });
      return;
    }
    try {
      await createUser(email, password);
    } catch (error) {
      const described = describeError(error);
      if (!described.needsEmailVerification) {
        dispatch({ type: 'error', ...described });
        return;
      }
      // The account exists; the server refused the automatic login because the address is
      // unverified. Back to the sign-in form with the address kept, the password dropped
      // and the Resend button on screen.
      setPassword('');
      dispatch({ type: 'mode', mode: 'signIn' });
      dispatch({ type: 'info', message: ACCOUNT_CREATED, needsEmailVerification: true });
    }
  };

  const forgot = async () => {
    try {
      // Availability first, as the package did: a deployment with no mail transport
      // cannot send the link whatever the address says.
      if (!(await isEmailAvailable())) {
        dispatch({ type: 'error', message: 'Password reset is unavailable.' });
        return;
      }
      const invalid = validateEmail(email);
      if (invalid) {
        dispatch({ type: 'error', message: invalid });
        return;
      }
      await forgotPassword(email);
      dispatch({ type: 'mode', mode: 'signIn' });
      dispatch({ type: 'info', message: 'Email sent' });
    } catch (error) {
      dispatch({ type: 'error', ...describeError(error) });
    }
  };

  const resend = async () => {
    if (!email.trim()) {
      dispatch({ type: 'error', message: 'Please enter your email address.' });
      return;
    }
    try {
      await resendVerificationEmail({ email });
      dispatch({ type: 'info', message: 'Verification email sent! Please check your inbox.' });
    } catch (error) {
      // The message only, so the button survives its own failure: a Resend that could not
      // be sent is the moment the user most needs the button still there.
      dispatch({ type: 'error', message: describeError(error).message });
    }
  };

  const isSignUp = panel.mode === 'signUp';
  const isForgot = panel.mode === 'forgot';
  const submit = isForgot ? forgot : isSignUp ? signUp : signIn;

  return (
    // noValidate because the panel shows its own messages: native constraint validation
    // would refuse the submit before `validateEmail` ever ran, and say something else.
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="mb-3">
        <label className={LABEL} htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className={INPUT}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {!isForgot && (
        <div className="mb-3">
          <label className={LABEL} htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className={INPUT}
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      )}

      <Messages panel={panel} />

      {panel.needsEmailVerification && (
        <button type="button" className={`${GHOST} mt-3`} onClick={() => void resend()}>
          Resend
        </button>
      )}

      <button id="login-buttons-password" type="submit" className={`${PRIMARY} mt-3`}>
        {isSignUp ? 'Create account' : isForgot ? 'Reset password' : 'Sign in'}
      </button>

      {panel.mode === 'signIn' && (
        <div className="mt-[14px] flex justify-between">
          <a
            href="#"
            className={FOOTNOTE}
            onClick={(event) => {
              event.preventDefault();
              dispatch({ type: 'mode', mode: 'forgot' });
            }}
          >
            Forgot password
          </a>
          <a
            id="signup-link"
            href="#"
            className={FOOTNOTE}
            onClick={(event) => {
              event.preventDefault();
              dispatch({ type: 'mode', mode: 'signUp' });
            }}
          >
            Create account
          </a>
        </div>
      )}
      {panel.mode !== 'signIn' && (
        <button
          type="button"
          className={`${GHOST} mt-2`}
          onClick={() => dispatch({ type: 'mode', mode: 'signIn' })}
        >
          Cancel
        </button>
      )}
    </form>
  );
}

function UserMenu({ panel, dispatch }: PanelProps) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const change = async () => {
    const invalid = validatePassword(newPassword);
    if (invalid) {
      dispatch({ type: 'error', message: invalid });
      return;
    }
    try {
      await changePassword(oldPassword, newPassword);
      dispatch({ type: 'mode', mode: 'message' });
      dispatch({ type: 'info', message: 'Password changed' });
    } catch (error) {
      dispatch({ type: 'error', message: describeError(error).message });
    }
  };

  // The message-only flow: the panel is down to that one line, and the way out of it is
  // closing the panel.
  if (panel.mode === 'message') return <Messages panel={panel} />;

  if (panel.mode === 'changePassword') {
    return (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void change();
        }}
      >
        <div className="mb-3">
          <label className={LABEL} htmlFor="login-old-password">
            Current password
          </label>
          <input
            id="login-old-password"
            className={INPUT}
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(event) => setOldPassword(event.target.value)}
          />
        </div>
        <div className="mb-3">
          <label className={LABEL} htmlFor="login-new-password">
            New password
          </label>
          <input
            id="login-new-password"
            className={INPUT}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>
        <Messages panel={panel} />
        <button type="submit" className={`${PRIMARY} mt-3`}>
          Change password
        </button>
        <button
          type="button"
          className={`${GHOST} mt-2`}
          onClick={() => dispatch({ type: 'mode', mode: 'menu' })}
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <>
      <Messages panel={panel} />
      <button
        type="button"
        className={`${GHOST}${panel.error || panel.info ? ' mt-3' : ''}`}
        onClick={() => dispatch({ type: 'mode', mode: 'changePassword' })}
      >
        Change password
      </button>
      <button type="button" className={`${PRIMARY} mt-2`} onClick={() => void logout()}>
        Sign out
      </button>
    </>
  );
}

// A fixed overlay rather than the layout's <dialog>: these two are raised by an emailed
// link while the page loads, and keep their own state rather than a queued message.
function Dialog({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-[rgba(12,20,28,.7)] pt-30"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className={DIALOG}>{children}</div>
    </div>
  );
}

function ResetPasswordDialog({ request }: { request: ResetRequest }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // `done()` is accounts-base's "the app has finished with this token"; it has to be
  // called on the way out whether or not the password was actually reset.
  const close = () => {
    resetToken.set(null);
    request.done();
  };

  const set = async () => {
    const invalid = validatePassword(password);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      await resetPassword(request.token, password);
      close();
      notice.set({ kind: 'reset' });
    } catch (failure) {
      setError(describeError(failure).message);
    }
  };

  return (
    <Dialog label="Reset password">
      <button
        type="button"
        className="ml-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-xl leading-none text-white/60 hover:bg-raised hover:text-white"
        aria-label="Close"
        onClick={close}
      >
        ×
      </button>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void set();
        }}
      >
        <label className={LABEL} htmlFor="reset-password-new-password">
          New password
        </label>
        <input
          id="reset-password-new-password"
          className={INPUT}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <div role="alert" className="mt-3 text-sm text-error">
            {error}
          </div>
        )}
        <button type="submit" className={`${PRIMARY} mt-3`}>
          Set password
        </button>
      </form>
    </Dialog>
  );
}

function NoticeDialog({ state, user }: { state: Notice; user: Meteor.User | null }) {
  const heading =
    state.kind === 'verified' ? 'Email verified' : state.kind === 'reset' ? 'Password reset' : null;

  return (
    <Dialog label={heading ?? 'Error'}>
      {heading ? (
        <>
          <p className="mb-2 font-semibold">{heading}</p>
          <p className="mb-5">You are now logged in as: {user ? getUsername(user) : ''}</p>
        </>
      ) : (
        <p role="alert" className="mb-5 text-error">
          {state.kind === 'error' && state.message}
        </p>
      )}
      <button type="button" className={PRIMARY} onClick={() => notice.set(null)}>
        Dismiss
      </button>
    </Dialog>
  );
}

export function AccountsMenu() {
  const user = useTracker(() => Meteor.user());
  const userId = useTracker(() => Meteor.userId());
  const loggingIn = useTracker(() => Meteor.loggingIn());
  const request = useTracker(() => resetToken.get());
  const pending = useTracker(() => notice.get());
  const [panel, dispatch] = useReducer(panelReducer, initialPanel);
  const toggleRef = useRef<HTMLAnchorElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // A login — or a session restored on load — is the answer to whatever the panel was
  // asking, and a sign-out leaves nothing on screen worth keeping either.
  useEffect(() => {
    dispatch({ type: 'close' });
  }, [userId]);

  useEffect(() => {
    if (!panel.open) return;
    const onClick = (event: MouseEvent) => {
      // A document-level click always has an element target; `EventTarget` is the wider
      // type the DOM lib gives it for the cases (window, XHR) this listener never sees.
      const target = event.target as Node;
      // The toggle has its own handler; without this exemption the two would cancel out.
      if (toggleRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      dispatch({ type: 'close' });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dispatch({ type: 'close' });
    };
    // Capture, not bubble. React runs an onClick handler at its own root and flushes the
    // re-render before the event reaches document, so a link that switches the panel's mode
    // is already off the DOM by then and `panelRef.contains` reads it as an outside click.
    // The capture phase runs before all of that, while the target is still in the panel.
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panel.open]);

  // The spinner replaces the link, but never the panel: a round trip to the server flips
  // `Meteor.loggingIn()` on and off, and unmounting the form over it would drop the address
  // the user typed — leaving them to retype it after every refused password.
  const widget = (
    <>
      {loggingIn ? (
        <span className={`${TOGGLE} text-white/55`} role="status">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
            aria-hidden="true"
          />
          <span className="sr-only">Signing in</span>
        </span>
      ) : (
        <a
          id={user ? 'login-name-link' : 'login-sign-in-link'}
          ref={toggleRef}
          className={`${TOGGLE} text-white/55 hover:text-white`}
          href="#"
          onClick={(event) => {
            event.preventDefault();
            dispatch({ type: 'toggle', home: user ? 'menu' : 'signIn' });
          }}
        >
          {user ? getUsername(user) : 'Sign in'}
        </a>
      )}
      {panel.open && (
        <div className={PANEL} ref={panelRef}>
          {user ? (
            <UserMenu panel={panel} dispatch={dispatch} />
          ) : (
            <SignInPanel panel={panel} dispatch={dispatch} />
          )}
        </div>
      )}
    </>
  );

  // The dialogs sit outside the widget: an emailed link is followed with the panel shut,
  // and while a login is still in flight.
  return (
    <>
      {widget}
      {request && <ResetPasswordDialog request={request} />}
      {pending && <NoticeDialog state={pending} user={user} />}
    </>
  );
}
