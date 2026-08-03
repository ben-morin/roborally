// server/cron.js configures Accounts inside Meteor.startup: the email allowlist that
// decides who may register, and the verification gate that decides who may log in.
// Both are security-relevant and neither is reachable without running that block, so the
// harness captures the validators Accounts.validateNewUser/validateLoginAttempt receive.
import { beforeEach, describe, expect, it } from 'vitest';
import '../helpers/server.js';
import {
  accountsHooks,
  resetAccounts,
  resetFakeCollections,
  runStartup,
  setSettings,
} from '../setup.js';

// Re-runs the startup block against a fresh settings document and hands back the single
// validator of each kind it registered.
async function configure(settings = {}) {
  resetAccounts();
  setSettings(settings);
  await runStartup();
  const hooks = accountsHooks();
  expect(hooks.validateNewUser).toHaveLength(1);
  expect(hooks.validateLoginAttempt).toHaveLength(1);
  return { newUser: hooks.validateNewUser[0], login: hooks.validateLoginAttempt[0] };
}

const withEmail = (address) => ({ emails: [{ address }] });

beforeEach(() => resetFakeCollections());

describe('Accounts.config', () => {
  it('turns off ambiguous error messages and names the site', async () => {
    await configure();

    expect(Accounts._options.ambiguousErrorMessages).toBe(false);
    expect(Accounts.emailTemplates.siteName).toBe('RoboRally');
  });

  it('enables verification e-mail only when VERIFY_EMAILS is set', async () => {
    await configure();
    expect(Accounts._options.sendVerificationEmail).toBe(false);

    await configure({ VERIFY_EMAILS: true });
    expect(Accounts._options.sendVerificationEmail).toBe(true);
  });

  it('applies MAIL_FROM when present and leaves the default alone otherwise', async () => {
    await configure();
    expect(Accounts.emailTemplates.from).toBeUndefined();

    await configure({ MAIL_FROM: 'robots@example.com' });
    expect(Accounts.emailTemplates.from).toBe('robots@example.com');
  });
});

describe('validateNewUser — registration allowlist', () => {
  it('allows anyone when neither list is configured', async () => {
    const { newUser } = await configure();

    expect(newUser(withEmail('stranger@example.com'))).toBe(true);
  });

  it('allows anyone when both lists are configured but empty', async () => {
    const { newUser } = await configure({ ALLOWED_EMAILS: [], ALLOWED_DOMAINS: [] });

    expect(newUser(withEmail('stranger@example.com'))).toBe(true);
  });

  it('allows an address on the email allowlist', async () => {
    const { newUser } = await configure({ ALLOWED_EMAILS: ['ben@example.com'] });

    expect(newUser(withEmail('ben@example.com'))).toBe(true);
  });

  it('allows any address on an allowlisted domain', async () => {
    const { newUser } = await configure({ ALLOWED_DOMAINS: ['example.com'] });

    expect(newUser(withEmail('anyone@example.com'))).toBe(true);
  });

  it('rejects an address that matches neither list', async () => {
    const { newUser } = await configure({
      ALLOWED_EMAILS: ['ben@example.com'],
      ALLOWED_DOMAINS: ['zebraworks.com'],
    });

    expect(() => newUser(withEmail('stranger@elsewhere.com'))).toThrow(
      "Email isn't allowed to register on this server."
    );
  });

  it('rejects a lookalike domain rather than matching on suffix', async () => {
    const { newUser } = await configure({ ALLOWED_DOMAINS: ['example.com'] });

    expect(() => newUser(withEmail('attacker@notexample.com'))).toThrow();
    expect(() => newUser(withEmail('attacker@example.com.evil.net'))).toThrow();
  });

  it('takes the domain after the last @, so an address with two cannot smuggle one in', async () => {
    const { newUser } = await configure({ ALLOWED_DOMAINS: ['example.com'] });

    expect(() => newUser(withEmail('"a@example.com"@evil.net'))).toThrow();
  });

  it('lowercases the address before comparing, so the settings must be lowercase', async () => {
    const shouty = await configure({ ALLOWED_EMAILS: ['BEN@EXAMPLE.COM'] });
    // The setting is compared verbatim against a lowercased address, so an uppercase
    // entry in settings.json never matches anything.
    expect(() => shouty.newUser(withEmail('BEN@EXAMPLE.COM'))).toThrow();

    const quiet = await configure({ ALLOWED_EMAILS: ['ben@example.com'] });
    expect(quiet.newUser(withEmail('BEN@EXAMPLE.COM'))).toBe(true);
  });

  it('allows a user carrying no email address at all', async () => {
    const { newUser } = await configure({ ALLOWED_EMAILS: ['ben@example.com'] });

    // Password accounts always have one; OAuth services need not, and the check bails
    // out rather than rejecting them.
    expect(newUser({})).toBe(true);
    expect(newUser({ emails: [] })).toBe(true);
  });
});

describe('validateLoginAttempt — verification gate', () => {
  const attempt = (user, allowed = true) => ({ allowed, user });

  it('passes through a login the stack already rejected', async () => {
    const { login } = await configure();

    expect(login(attempt(withEmail('ben@example.com'), false))).toBe(false);
  });

  it('allows an unverified address when verification is off', async () => {
    const { login } = await configure({ VERIFY_EMAILS: false });

    expect(login(attempt({ emails: [{ address: 'ben@example.com', verified: false }] }))).toBe(
      true
    );
  });

  it('blocks an unverified address when verification is on', async () => {
    const { login } = await configure({ VERIFY_EMAILS: true });

    expect(() =>
      login(attempt({ emails: [{ address: 'ben@example.com', verified: false }] }))
    ).toThrow('You must verify your email address before logging in. Please check your inbox.');
  });

  it('allows a login when any one address is verified', async () => {
    const { login } = await configure({ VERIFY_EMAILS: true });

    expect(
      login(
        attempt({
          emails: [
            { address: 'old@example.com', verified: false },
            { address: 'new@example.com', verified: true },
          ],
        })
      )
    ).toBe(true);
  });

  it('allows a user with no emails array through the gate', async () => {
    const { login } = await configure({ VERIFY_EMAILS: true });

    expect(login(attempt({}))).toBe(true);
  });
});
