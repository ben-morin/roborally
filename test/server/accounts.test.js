// Two files configure Accounts inside Meteor.startup, and everything they do is
// security-relevant: server/cron.ts has the email allowlist that decides who may
// register and the verification gate that decides who may log in; server/accounts.ts has
// the `onCreateUser` hook and the backfill that put a publishable display name on every
// user document, plus the deny rule that stops a client rewriting it. None of it is
// reachable without running the startup block, so the harness captures the callbacks
// Accounts is handed.
import { beforeEach, describe, expect, it } from 'vitest';
import '../helpers/server.js';
import {
  accountsHooks,
  collectionRules,
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
  expect(hooks.onCreateUser).toHaveLength(1);
  return {
    newUser: hooks.validateNewUser[0],
    login: hooks.validateLoginAttempt[0],
    createUser: hooks.onCreateUser[0],
  };
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

describe('onCreateUser — the display name every user document carries', () => {
  it('derives profile.name from the local part of the address, verbatim', async () => {
    const { createUser } = await configure();

    const user = createUser({}, { _id: 'u1', emails: [{ address: 'ben.morin@example.com' }] });

    // Punctuation is kept as written — the local part is the name.
    expect(user.profile).toEqual({ name: 'ben.morin' });
  });

  it('lowercases the name', async () => {
    const { createUser } = await configure();

    const user = createUser({}, { _id: 'u1', emails: [{ address: 'Ben.Morin@Example.COM' }] });

    expect(user.profile).toEqual({ name: 'ben.morin' });
  });

  // ALLOWED_DOMAINS is plural, so this is reachable, and it is accepted: nothing keys off
  // the display name. Every statistic groups on the account's userId — see
  // test/server/highscores.test.js — so the only cost is two identical-looking rows.
  it('gives two accounts on different domains the same name', async () => {
    const { createUser } = await configure();

    const one = createUser({}, { _id: 'u1', emails: [{ address: 'user@domain1.com' }] });
    const two = createUser({}, { _id: 'u2', emails: [{ address: 'user@domain2.com' }] });

    expect(one.profile.name).toBe('user');
    expect(two.profile.name).toBe('user');
  });

  // profile.name is the one field of somebody else's user document this app publishes,
  // and `options` is whatever the sign-up form sent. Honouring it would let a new account
  // pick any display name — including one already in use in the chat and the rankings.
  it('ignores a client-supplied profile', async () => {
    const { createUser } = await configure();

    const user = createUser(
      { profile: { name: 'Ben', admin: true } },
      { _id: 'u1', emails: [{ address: 'impostor@example.com' }] }
    );

    expect(user.profile).toEqual({ name: 'impostor' });
  });

  it('falls back to the id for an account with no address', async () => {
    const { createUser } = await configure();

    // Password accounts always carry one; this is the OAuth-shaped case, and the point is
    // that the document still ends up with a name rather than an undefined one.
    expect(createUser({}, { _id: 'u1' }).profile).toEqual({ name: 'u1' });
  });
});

describe('profile.name backfill', () => {
  it('names users created before display names were stored server-side', async () => {
    await Meteor.users.insertAsync({
      _id: 'old',
      emails: [{ address: 'ben.morin@example.com', verified: true }],
      status: { online: false },
    });

    await configure();

    const user = await Meteor.users.findOneAsync('old');
    expect(user.profile).toEqual({ name: 'ben.morin' });
    // A $set, not a whole-document replace — the account still has to work.
    expect(user.emails).toEqual([{ address: 'ben.morin@example.com', verified: true }]);
  });

  it('leaves an existing name alone', async () => {
    await Meteor.users.insertAsync({
      _id: 'named',
      profile: { name: 'Established Name' },
      emails: [{ address: 'someone@example.com' }],
    });

    await configure();

    expect((await Meteor.users.findOneAsync('named')).profile.name).toBe('Established Name');
  });
});

describe('Meteor.users write rules', () => {
  it('denies every client-side update, including the profile one accounts-base allows', async () => {
    const { deny } = collectionRules(Meteor.users);

    expect(deny).toHaveLength(1);
    // accounts-base's own allow rule passes exactly this: the owner, touching only
    // `profile`. deny wins, so the answer has to be "denied" anyway.
    expect(
      deny[0].update('u1', { _id: 'u1' }, ['profile'], { $set: { profile: { name: 'Ben' } } })
    ).toBe(true);
  });
});
