// The accounts UI's logic half: field validation, the error-to-message mapping and the
// panel's state machine. No React, no Meteor, no DOM — the component in
// client/views/accounts/ is wiring over this.
//
// Thresholds and wording are the ones the Blaze widget this replaces used, kept
// verbatim so nobody has to relearn them.

/** `null` when the field passes, otherwise the message to show. */
export function validateEmail(email: string): string | null {
  return email.includes('@') ? null : 'Invalid email';
}

/** `null` when the field passes, otherwise the message to show. */
export function validatePassword(password: string): string | null {
  return password.length >= 6 ? null : 'Password must be at least 6 characters long';
}

// What a rejected accounts call has to say for itself. A `Meteor.Error` carries `error`
// (the code) and `reason` (the human line); both are optional here because anything at all
// can be thrown, and `catch` binds `unknown` under strict — the same guard `checkArgs` in
// both/schemas/methods.ts uses, for the same reason.
interface AccountsError {
  error?: string | number;
  reason?: string;
}

const isAccountsError = (error: unknown): error is AccountsError =>
  typeof error === 'object' && error !== null;

export function describeError(error: unknown): {
  message: string;
  needsEmailVerification: boolean;
} {
  const failure = isAccountsError(error) ? error : {};
  return {
    message: failure.reason || 'Unknown error',
    // The one error code the UI reacts to rather than just prints: it is what puts the
    // Resend button on screen.
    needsEmailVerification: failure.error === 'email-not-verified',
  };
}

export type Mode = 'signIn' | 'signUp' | 'forgot' | 'menu' | 'changePassword' | 'message';

export interface Panel {
  open: boolean;
  mode: Mode;
  error: string | null;
  info: string | null;
  needsEmailVerification: boolean;
}

export type PanelAction =
  | { type: 'toggle'; home: Mode }
  | { type: 'close' }
  | { type: 'mode'; mode: Mode }
  | { type: 'error'; message: string; needsEmailVerification?: boolean }
  | { type: 'info'; message: string; needsEmailVerification?: boolean }
  | { type: 'reset' };

export const initialPanel: Panel = {
  open: false,
  mode: 'signIn',
  error: null,
  info: null,
  needsEmailVerification: false,
};

// The package's `resetMessages`: both messages and the verification flag.
const cleared = { error: null, info: null, needsEmailVerification: false };

export function panelReducer(panel: Panel, action: PanelAction): Panel {
  switch (action.type) {
    // The reducer does not know whether anyone is logged in, so the caller says where home
    // is: the sign-in form logged out, the user menu logged in.
    case 'toggle':
      return panel.open
        ? { ...panel, ...cleared, open: false }
        : { ...panel, ...cleared, open: true, mode: action.home };
    // The mode left behind is irrelevant — the next toggle sets it.
    case 'close':
      return { ...panel, ...cleared, open: false };
    case 'mode':
      return { ...panel, ...cleared, mode: action.mode };
    case 'error':
      return {
        ...panel,
        error: action.message,
        info: null,
        // Only an action that says so moves the flag. The Resend button has failures of
        // its own ('Please enter your email address.') and has to survive them.
        needsEmailVerification: action.needsEmailVerification ?? panel.needsEmailVerification,
      };
    case 'info':
      return {
        ...panel,
        error: null,
        info: action.message,
        // Same rule as 'error', and it is what makes sign-up's unverified-email landing
        // reachable: that one dispatch has to say "here is a message" and "the address
        // still needs verifying" at once.
        needsEmailVerification: action.needsEmailVerification ?? panel.needsEmailVerification,
      };
    case 'reset':
      return { ...panel, ...cleared };
  }
}
