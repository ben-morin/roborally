// The accounts UI's logic half, with no DOM in sight: the two field validators, the
// mapping from a rejected accounts call to something worth showing, and the panel's
// reducer. The component in client/views/accounts/ is wiring over exactly this, so a
// transition pinned here is one the component test does not have to re-derive.
import { describe, expect, it } from 'vitest';
import {
  describeError,
  initialPanel,
  panelReducer,
  validateEmail,
  validatePassword,
} from '../../client/lib/accounts.ts';

describe('validateEmail', () => {
  it('passes anything containing an @', () => {
    expect(validateEmail('ben@example.com')).toBeNull();
    expect(validateEmail('@')).toBeNull();
  });

  it('rejects an address with no @', () => {
    expect(validateEmail('ben')).toBe('Invalid email');
    expect(validateEmail('')).toBe('Invalid email');
  });
});

describe('validatePassword', () => {
  it('passes at six characters', () => {
    expect(validatePassword('123456')).toBeNull();
    expect(validatePassword('a long passphrase')).toBeNull();
  });

  it('rejects anything shorter', () => {
    expect(validatePassword('12345')).toBe('Password must be at least 6 characters long');
    expect(validatePassword('')).toBe('Password must be at least 6 characters long');
  });
});

describe('describeError', () => {
  it('reads reason off a Meteor.Error', () => {
    expect(describeError(new Meteor.Error(403, 'Incorrect password'))).toEqual({
      message: 'Incorrect password',
      needsEmailVerification: false,
    });
  });

  it('flags the one code the UI reacts to', () => {
    const error = new Meteor.Error('email-not-verified', 'Email not verified');
    expect(describeError(error)).toEqual({
      message: 'Email not verified',
      needsEmailVerification: true,
    });
  });

  it('falls back to Unknown error for a bare Error', () => {
    expect(describeError(new Error('boom'))).toEqual({
      message: 'Unknown error',
      needsEmailVerification: false,
    });
  });

  it.each([
    ['a string', 'boom'],
    ['undefined', undefined],
    ['null', null],
  ])('falls back to Unknown error for %s', (_label, thrown) => {
    expect(describeError(thrown)).toEqual({
      message: 'Unknown error',
      needsEmailVerification: false,
    });
  });
});

describe('panelReducer', () => {
  const open = (panel = initialPanel, home = 'signIn') =>
    panelReducer(panel, { type: 'toggle', home });

  it('starts closed on the sign-in form', () => {
    expect(initialPanel).toEqual({
      open: false,
      mode: 'signIn',
      error: null,
      info: null,
      needsEmailVerification: false,
    });
  });

  it('opens a closed panel at the home the caller names', () => {
    expect(open()).toMatchObject({ open: true, mode: 'signIn' });
    expect(open(initialPanel, 'menu')).toMatchObject({ open: true, mode: 'menu' });
  });

  it('closes an open panel', () => {
    expect(open(open())).toMatchObject({ open: false });
  });

  it('clears the messages as it opens', () => {
    const noisy = panelReducer(open(), { type: 'error', message: 'Incorrect password' });
    expect(open(panelReducer(noisy, { type: 'toggle', home: 'signIn' }))).toMatchObject({
      open: true,
      error: null,
      info: null,
    });
  });

  it('closes and clears on close', () => {
    const noisy = panelReducer(open(), { type: 'info', message: 'Email sent' });
    expect(panelReducer(noisy, { type: 'close' })).toMatchObject({
      open: false,
      error: null,
      info: null,
    });
  });

  it('switches mode and clears both messages and the verification flag', () => {
    const noisy = panelReducer(open(), {
      type: 'error',
      message: 'Email not verified',
      needsEmailVerification: true,
    });
    expect(panelReducer(noisy, { type: 'mode', mode: 'signUp' })).toEqual({
      open: true,
      mode: 'signUp',
      error: null,
      info: null,
      needsEmailVerification: false,
    });
  });

  it('shows an error in place of the info message', () => {
    const informed = panelReducer(open(), { type: 'info', message: 'Email sent' });
    expect(panelReducer(informed, { type: 'error', message: 'Invalid email' })).toMatchObject({
      error: 'Invalid email',
      info: null,
    });
  });

  it('shows an info message in place of the error', () => {
    const failed = panelReducer(open(), { type: 'error', message: 'Invalid email' });
    expect(panelReducer(failed, { type: 'info', message: 'Email sent' })).toMatchObject({
      error: null,
      info: 'Email sent',
    });
  });

  it('leaves the verification flag alone unless an action names it', () => {
    const unverified = panelReducer(open(), {
      type: 'error',
      message: 'Email not verified',
      needsEmailVerification: true,
    });
    // The Resend button has to survive its own failure and its own success.
    const empty = panelReducer(unverified, { type: 'error', message: 'Please enter your email.' });
    expect(empty.needsEmailVerification).toBe(true);
    const sent = panelReducer(empty, { type: 'info', message: 'Verification email sent!' });
    expect(sent.needsEmailVerification).toBe(true);
  });

  it('sets the verification flag from an info message that names it', () => {
    // Sign-up's unverified-email landing needs both at once: the mode switch has just
    // cleared everything, and the info message has to put the flag back.
    const signIn = panelReducer(open(), { type: 'mode', mode: 'signIn' });
    expect(
      panelReducer(signIn, {
        type: 'info',
        message: 'Account created!',
        needsEmailVerification: true,
      })
    ).toMatchObject({ info: 'Account created!', needsEmailVerification: true });
  });

  it('drops the verification flag when an action names it false', () => {
    const unverified = panelReducer(open(), {
      type: 'error',
      message: 'Email not verified',
      needsEmailVerification: true,
    });
    const other = panelReducer(unverified, {
      type: 'error',
      message: 'Incorrect password',
      needsEmailVerification: false,
    });
    expect(other.needsEmailVerification).toBe(false);
  });

  it('resets the messages without closing', () => {
    const unverified = panelReducer(open(), {
      type: 'error',
      message: 'Email not verified',
      needsEmailVerification: true,
    });
    expect(panelReducer(unverified, { type: 'reset' })).toEqual({
      open: true,
      mode: 'signIn',
      error: null,
      info: null,
      needsEmailVerification: false,
    });
  });

  it('returns a new object rather than mutating the panel', () => {
    const before = open();
    const after = panelReducer(before, { type: 'error', message: 'Invalid email' });
    expect(after).not.toBe(before);
    expect(before.error).toBeNull();
  });
});
