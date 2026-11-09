// A user's own Edit profile: `updateProfile`. The username follows the one rule; a new email
// asks for the password, the allowlist, a free address, no admin's way off ADMIN_EMAILS and,
// under VERIFY_EMAILS, a verification email.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../helpers/server.js';
import {
  accountsHooks,
  loginAs,
  logout,
  resetAccounts,
  resetFakeCollections,
  runStartup,
  setSettings,
} from '../setup.js';
import { Games } from '../../collections/games.ts';
import { Highscores } from '../../collections/highscores.ts';
import { buildHighscores } from '../../server/highscores.ts';

const update = (fields) =>
  Meteor.callAsync('updateProfile', {
    name: 'ben',
    email: 'ben@example.com',
    password: '',
    ...fields,
  });
const stored = (id) => Meteor.users.findOneAsync(id);

// The settings, and what Accounts.config was handed from them (VERIFY_EMAILS).
async function configure(settings = {}) {
  resetAccounts();
  setSettings(settings);
  await runStartup();
}

beforeEach(async () => {
  resetFakeCollections();
  await configure();
  await Meteor.users.insertAsync({
    _id: 'ann',
    profile: { name: 'Ann' },
    emails: [{ address: 'ann@example.com', verified: true }],
  });
  await loginAs({
    _id: 'ben',
    profile: { name: 'ben' },
    emails: [{ address: 'ben@example.com', verified: true }],
    services: { password: { plain: 'secret1' } },
  });
});
afterEach(() => setSettings());

describe('updateProfile — the username', () => {
  it('refuses an anonymous caller', async () => {
    logout();
    await expect(update({ name: 'Benjamin' })).rejects.toMatchObject({ error: 401 });
  });

  it('renames without a password, trimmed', async () => {
    expect(await update({ name: '  Benjamin ' })).toEqual({ verificationSent: false });
    expect((await stored('ben')).profile.name).toBe('Benjamin');
  });

  it('shows the new username in the rankings at once', async () => {
    const gameId = await Games.insertAsync({ winner: 'ben', winnerUserId: 'ben' });
    await buildHighscores();

    await update({ name: 'Benjamin' });

    expect(await Highscores.findOneAsync({ type: 'mostWon' })).toMatchObject({
      name: 'Benjamin',
    });
    // The game keeps the name it was played under.
    expect((await Games.findOneAsync(gameId)).winner).toBe('ben');
  });

  it('refuses a taken name in any case, and a bad shape, writing nothing', async () => {
    await expect(update({ name: 'ANN' })).rejects.toMatchObject({
      error: 409,
      reason: 'That username is taken.',
    });
    await expect(update({ name: 'Nobody' })).rejects.toMatchObject({ error: 400 });
    await expect(update({ name: 'be' })).rejects.toMatchObject({ error: 400 });
    expect((await stored('ben')).profile.name).toBe('ben');
  });

  // An older name can break today's rule; it must not block an email change.
  it('does not check an unchanged name', async () => {
    await Meteor.users.updateAsync('ben', { $set: { 'profile.name': 'be' } });

    await update({ name: 'be', email: 'benjamin@example.com', password: 'secret1' });

    expect((await stored('ben')).emails[0].address).toBe('benjamin@example.com');
  });
});

describe('updateProfile — the email', () => {
  it('needs the current password, and refuses a wrong one', async () => {
    await expect(update({ email: 'benjamin@example.com' })).rejects.toMatchObject({
      error: 403,
      reason: 'Type your current password to change your email.',
    });
    await expect(
      update({ email: 'benjamin@example.com', password: 'guess' })
    ).rejects.toMatchObject({ error: 403, reason: 'Incorrect password' });
    expect((await stored('ben')).emails[0].address).toBe('ben@example.com');
  });

  it('replaces the address, unverified, with the right password', async () => {
    const result = await update({ email: ' benjamin@example.com ', password: 'secret1' });

    expect(result).toEqual({ verificationSent: false });
    expect((await stored('ben')).emails).toEqual([
      { address: 'benjamin@example.com', verified: false },
    ]);
  });

  it('treats a change of case alone as no change, and needs no password', async () => {
    await update({ email: 'BEN@example.com' });
    expect((await stored('ben')).emails[0]).toEqual({ address: 'ben@example.com', verified: true });
  });

  it('refuses an address without an @', async () => {
    await expect(update({ email: 'benjamin', password: 'secret1' })).rejects.toMatchObject({
      error: 400,
    });
  });

  it('refuses an address another account holds, in any case', async () => {
    await expect(update({ email: 'ANN@example.com', password: 'secret1' })).rejects.toMatchObject({
      error: 409,
    });
  });

  it('holds a new address to the sign-up allowlist', async () => {
    setSettings({ ALLOWED_DOMAINS: ['example.com'] });

    await expect(update({ email: 'ben@other.org', password: 'secret1' })).rejects.toMatchObject({
      error: 403,
      reason: "That email isn't allowed on this server.",
    });
    await update({ email: 'benjamin@example.com', password: 'secret1' });
    expect((await stored('ben')).emails[0].address).toBe('benjamin@example.com');
  });

  it('writes neither field when the email is refused', async () => {
    await expect(
      update({ name: 'Benjamin', email: 'benjamin@example.com', password: 'guess' })
    ).rejects.toMatchObject({ error: 403 });
    expect((await stored('ben')).profile.name).toBe('ben');
  });
});

describe('updateProfile — an admin', () => {
  it('cannot move off ADMIN_EMAILS', async () => {
    setSettings({ ADMIN_EMAILS: ['ben@example.com'] });

    await expect(
      update({ email: 'benjamin@example.com', password: 'secret1' })
    ).rejects.toMatchObject({ error: 409 });
    expect((await stored('ben')).emails[0].address).toBe('ben@example.com');
  });

  it('can move to another listed address while VERIFY_EMAILS is off', async () => {
    setSettings({ ADMIN_EMAILS: ['ben@example.com', 'boss@example.com'] });

    await update({ email: 'boss@example.com', password: 'secret1' });

    expect((await stored('ben')).emails[0].address).toBe('boss@example.com');
  });

  // The new address starts unverified, and under VERIFY_EMAILS that is no admin rights.
  it('cannot move even to a listed address while VERIFY_EMAILS is on', async () => {
    await configure({ ADMIN_EMAILS: ['ben@example.com', 'boss@example.com'], VERIFY_EMAILS: true });

    await expect(update({ email: 'boss@example.com', password: 'secret1' })).rejects.toMatchObject({
      error: 409,
    });
  });
});

describe('updateProfile — under VERIFY_EMAILS', () => {
  beforeEach(() => configure({ VERIFY_EMAILS: true }));

  it('sends the verification email for the new address and says so', async () => {
    const result = await update({ email: 'benjamin@example.com', password: 'secret1' });

    expect(result).toEqual({ verificationSent: true });
    expect(accountsHooks().verificationEmails).toEqual(['ben']);
  });

  it('refuses an email change it could not verify, writing nothing', async () => {
    const previous = process.env.MAIL_URL;
    delete process.env.MAIL_URL;
    Meteor.isDevelopment = false;
    try {
      await expect(
        update({ email: 'benjamin@example.com', password: 'secret1' })
      ).rejects.toMatchObject({ error: 409 });
    } finally {
      Meteor.isDevelopment = true;
      if (previous !== undefined) process.env.MAIL_URL = previous;
    }
    expect((await stored('ben')).emails[0].address).toBe('ben@example.com');
    expect(accountsHooks().verificationEmails).toEqual([]);
  });

  it('sends nothing for a rename alone', async () => {
    expect(await update({ name: 'Benjamin' })).toEqual({ verificationSent: false });
    expect(accountsHooks().verificationEmails).toEqual([]);
  });
});
