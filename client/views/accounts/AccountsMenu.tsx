// The navbar's accounts widget: the "Sign in" link or the display name, the panel that
// drops out of it, and the two dialogs the emailed links raise. It replaces a Blaze
// widget whose flows and wording this mirrors — the messages are the ones users have been
// reading for years, so they are kept verbatim.
//
// Bootstrap classes, no Bootstrap JS: client/main.js imports the bootstrap bundle, whose
// delegated handlers key on `data-bs-*`, and a dropdown owned by both that and React state
// fights itself. So there is no `data-bs-*` attribute here and dismissal is done by hand.
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

interface PanelProps {
  panel: Panel;
  dispatch: Dispatch<PanelAction>;
}

// Above the buttons and centred, which is where the widget this replaces put it. Every
// panel state renders it in that one spot rather than the container doing it once.
function Messages({ panel }: { panel: Panel }) {
  if (!panel.error && !panel.info) return null;
  return (
    <div role="alert" className={`login-message ${panel.error ? 'error-message' : 'info-message'}`}>
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
      <div className="mb-2">
        <label className="form-label small mb-1" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="form-control form-control-sm"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {!isForgot && (
        <div className="mb-2">
          <label className="form-label small mb-1" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="form-control form-control-sm"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      )}

      <Messages panel={panel} />

      {panel.needsEmailVerification && (
        <button
          type="button"
          className="btn btn-light btn-sm w-100 mb-2"
          onClick={() => void resend()}
        >
          Resend
        </button>
      )}

      <button id="login-buttons-password" type="submit" className="btn btn-primary btn-sm w-100">
        {isSignUp ? 'Create account' : isForgot ? 'Reset password' : 'Sign in'}
      </button>

      {panel.mode === 'signIn' && (
        <div className="additional-link-container mt-2">
          <a
            href="#"
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
            className="ms-3"
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
          className="btn btn-light btn-sm w-100 mt-2"
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
        <div className="mb-2">
          <label className="form-label small mb-1" htmlFor="login-old-password">
            Current password
          </label>
          <input
            id="login-old-password"
            className="form-control form-control-sm"
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(event) => setOldPassword(event.target.value)}
          />
        </div>
        <div className="mb-2">
          <label className="form-label small mb-1" htmlFor="login-new-password">
            New password
          </label>
          <input
            id="login-new-password"
            className="form-control form-control-sm"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>
        <Messages panel={panel} />
        <button type="submit" className="btn btn-primary btn-sm w-100">
          Change password
        </button>
        <button
          type="button"
          className="btn btn-light btn-sm w-100 mt-2"
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
        className="btn btn-light btn-sm w-100"
        onClick={() => dispatch({ type: 'mode', mode: 'changePassword' })}
      >
        Change password
      </button>
      <button
        type="button"
        className="btn btn-primary btn-sm w-100 mt-2"
        onClick={() => void logout()}
      >
        Sign out
      </button>
    </>
  );
}

// Both dialogs are static Bootstrap markup — `.modal.d-block` plus a backdrop of our own —
// because Bootstrap's own modal JS would want to own the same element React is rendering.
function Dialog({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="modal d-block" role="dialog" aria-modal="true" aria-label={label}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content p-3">{children}</div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
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
      <button type="button" className="btn-close ms-auto" aria-label="Close" onClick={close} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void set();
        }}
      >
        <label className="form-label small mb-1" htmlFor="reset-password-new-password">
          New password
        </label>
        <input
          id="reset-password-new-password"
          className="form-control form-control-sm"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <div role="alert" className="small text-danger mt-2">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-sm w-100 mt-2">
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
          <p className="fw-bold mb-2">{heading}</p>
          <p>You are now logged in as: {user ? getUsername(user) : ''}</p>
        </>
      ) : (
        <p role="alert" className="text-danger">
          {state.kind === 'error' && state.message}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm w-100"
        onClick={() => notice.set(null)}
      >
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
        <span className="nav-link" role="status">
          <span className="spinner-border spinner-border-sm" aria-hidden="true" />
          <span className="visually-hidden">Signing in</span>
        </span>
      ) : (
        <a
          id={user ? 'login-name-link' : 'login-sign-in-link'}
          ref={toggleRef}
          className="nav-link"
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
        <div className="dropdown-menu dropdown-menu-end show p-3" ref={panelRef}>
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
