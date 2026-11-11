// Admin rights come from the private `ADMIN_EMAILS` setting and nowhere else, so these
// pin the rule itself (both/permissions.ts), the one method that tells a browser the
// answer, the startup warning for a listed address nobody has registered yet, and the
// user manager's actions — each refused to anybody but an admin.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { adminEmails, isAdminUser } from '../../both/permissions.ts';
import { Chat } from '../../collections/chat.ts';
import { Games } from '../../collections/games.ts';
import { Highscores } from '../../collections/highscores.ts';
import { Players } from '../../collections/players.ts';
import { buildHighscores } from '../../server/highscores.ts';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';

const call = (name, ...args) => Meteor.callAsync(name, ...args);
const withEmails = (...emails) => ({
  emails: emails.map((e) => (typeof e === 'string' ? { address: e, verified: false } : e)),
});

// The verified rule reads what Accounts.config was handed at startup, so a test that
// cares runs the real startup block.
async function configure(settings = {}) {
  resetAccounts();
  setSettings(settings);
  await runStartup();
}

beforeEach(() => {
  resetFakeCollections();
  resetAccounts();
  setSettings();
  logout();
});
afterEach(() => vi.restoreAllMocks());

describe('adminEmails', () => {
  it('is empty when the setting is missing or empty', () => {
    expect(adminEmails()).toEqual([]);
    setSettings({ ADMIN_EMAILS: [] });
    expect(adminEmails()).toEqual([]);
  });

  it('lowercases every address', () => {
    setSettings({ ADMIN_EMAILS: ['Ben@Example.COM', 'ann@example.com'] });
    expect(adminEmails()).toEqual(['ben@example.com', 'ann@example.com']);
  });

  it('takes a single string as a one-item list', () => {
    setSettings({ ADMIN_EMAILS: 'ben@example.com' });
    expect(adminEmails()).toEqual(['ben@example.com']);
  });

  it('ignores anything that is not an address', () => {
    setSettings({ ADMIN_EMAILS: ['ben@example.com', 7, null] });
    expect(adminEmails()).toEqual(['ben@example.com']);
    setSettings({ ADMIN_EMAILS: true });
    expect(adminEmails()).toEqual([]);
  });
});

describe('isAdminUser', () => {
  beforeEach(() => setSettings({ ADMIN_EMAILS: ['ben@example.com'] }));

  it('says yes for a listed address, whatever its case on either side', () => {
    expect(isAdminUser(withEmails('ben@example.com'))).toBe(true);
    expect(isAdminUser(withEmails('BEN@example.com'))).toBe(true);
    setSettings({ ADMIN_EMAILS: ['Ben@Example.com'] });
    expect(isAdminUser(withEmails('ben@example.com'))).toBe(true);
  });

  it('says no for an address that is not listed', () => {
    expect(isAdminUser(withEmails('ann@example.com'))).toBe(false);
  });

  it('says yes when any address on the account is listed', () => {
    expect(isAdminUser(withEmails('ann@example.com', 'ben@example.com'))).toBe(true);
  });

  it('says no for no user, no emails, or no admins configured', () => {
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
    expect(isAdminUser({})).toBe(false);
    setSettings();
    expect(isAdminUser(withEmails('ben@example.com'))).toBe(false);
  });

  it('accepts an unverified address while VERIFY_EMAILS is off', async () => {
    await configure({ ADMIN_EMAILS: ['ben@example.com'], VERIFY_EMAILS: false });
    expect(isAdminUser(withEmails('ben@example.com'))).toBe(true);
  });

  it('needs the listed address itself to be verified while VERIFY_EMAILS is on', async () => {
    await configure({ ADMIN_EMAILS: ['ben@example.com'], VERIFY_EMAILS: true });

    expect(isAdminUser(withEmails('ben@example.com'))).toBe(false);
    expect(isAdminUser(withEmails({ address: 'ben@example.com', verified: true }))).toBe(true);
    // A verified address that is not listed lends nothing to a listed one that is not verified.
    expect(
      isAdminUser(withEmails({ address: 'ann@example.com', verified: true }, 'ben@example.com'))
    ).toBe(false);
  });
});

describe('isAdmin method', () => {
  beforeEach(() => setSettings({ ADMIN_EMAILS: ['ben@example.com'] }));

  it('refuses an anonymous caller', async () => {
    await expect(call('isAdmin')).rejects.toMatchObject({ error: 401 });
  });

  it('answers false for a player', async () => {
    await loginAs({ emails: [{ address: 'ann@example.com', verified: true }] });
    expect(await call('isAdmin')).toBe(false);
  });

  it('answers true for an admin', async () => {
    await loginAs({ emails: [{ address: 'ben@example.com', verified: true }] });
    expect(await call('isAdmin')).toBe(true);
  });
});

describe('startup warning for an unclaimed admin address', () => {
  const warnings = () =>
    vi.mocked(console.warn).mock.calls.filter(([line]) => String(line).startsWith('ADMIN_EMAILS'));

  beforeEach(() => vi.spyOn(console, 'warn'));

  it('names each listed address that has no account', async () => {
    await configure({ ADMIN_EMAILS: ['ben@example.com', 'ann@example.com'] });

    const lines = warnings().map(([line]) => line);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('ben@example.com');
    expect(lines[1]).toContain('ann@example.com');
  });

  it('stays quiet for an address that has an account, in any case', async () => {
    await Meteor.users.insertAsync({ _id: 'ben', emails: [{ address: 'Ben@Example.com' }] });

    await configure({ ADMIN_EMAILS: ['ben@example.com'] });

    expect(warnings()).toEqual([]);
  });

  it('stays quiet when no admin is configured', async () => {
    await configure();
    expect(warnings()).toEqual([]);
  });
});

// ── The user manager's actions ──────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'admin@example.com';

async function asAdmin(extraAdmins = []) {
  setSettings({ ADMIN_EMAILS: [ADMIN_EMAIL, ...extraAdmins] });
  return loginAs({
    _id: 'admin',
    profile: { name: 'admin' },
    emails: [{ address: ADMIN_EMAIL, verified: true }],
  });
}

const insertAnn = (fields = {}) =>
  Meteor.users.insertAsync({
    _id: 'ann',
    profile: { name: 'ann' },
    emails: [{ address: 'ann@example.com', verified: false }],
    ...fields,
  });

const stored = (id) => Meteor.users.findOneAsync(id);

// Production without MAIL_URL: the one case where the server cannot send a link at all.
async function withoutMail(fn) {
  const previous = process.env.MAIL_URL;
  delete process.env.MAIL_URL;
  Meteor.isDevelopment = false;
  try {
    await fn();
  } finally {
    Meteor.isDevelopment = true;
    if (previous !== undefined) process.env.MAIL_URL = previous;
  }
}

const ADMIN_CALLS = [
  ['adminUpdateUser', { userId: 'ann', name: 'annie', email: 'annie@example.com', verified: true }],
  ['adminSetPassword', { userId: 'ann', password: 'secret1' }],
  ['adminSendResetEmail', { userId: 'ann' }],
  ['adminSendVerificationEmail', { userId: 'ann' }],
  ['adminLogoutUser', { userId: 'ann' }],
  ['adminDeleteUser', { userId: 'ann' }],
];

describe('every admin action', () => {
  beforeEach(() => insertAnn({ services: { resume: { loginTokens: [{ hashedToken: 't' }] } } }));

  it.each(ADMIN_CALLS)('%s refuses an anonymous caller', async (name, args) => {
    setSettings({ ADMIN_EMAILS: [ADMIN_EMAIL] });
    await expect(call(name, args)).rejects.toMatchObject({ error: 401 });
  });

  it.each(ADMIN_CALLS)('%s refuses a player and changes nothing', async (name, args) => {
    setSettings({ ADMIN_EMAILS: [ADMIN_EMAIL] });
    await loginAs({ _id: 'player', emails: [{ address: 'player@example.com', verified: true }] });
    const before = await stored('ann');

    await expect(call(name, args)).rejects.toMatchObject({ error: 403, reason: 'Admins only.' });

    expect(await stored('ann')).toEqual(before);
    const hooks = accountsHooks();
    expect([...hooks.passwordsSet, ...hooks.resetEmails, ...hooks.verificationEmails]).toEqual([]);
  });

  it.each(ADMIN_CALLS)(
    '%s refuses an admin whose address is unverified under VERIFY_EMAILS',
    async (name, args) => {
      await configure({ ADMIN_EMAILS: [ADMIN_EMAIL], VERIFY_EMAILS: true });
      await loginAs({ _id: 'admin', emails: [{ address: ADMIN_EMAIL, verified: false }] });

      await expect(call(name, args)).rejects.toMatchObject({ error: 403 });
    }
  );

  it.each(ADMIN_CALLS)('%s answers 404 for an unknown user', async (name, args) => {
    await asAdmin();
    await expect(call(name, { ...args, userId: 'nobody' })).rejects.toMatchObject({ error: 404 });
  });
});

describe('adminUpdateUser', () => {
  const update = (fields) =>
    call('adminUpdateUser', {
      userId: 'ann',
      name: 'ann',
      email: 'ann@example.com',
      verified: false,
      ...fields,
    });

  beforeEach(async () => {
    await asAdmin();
    await insertAnn();
  });

  it('renames a user and sets the verified flag, trimming the name', async () => {
    await update({ name: '  Annie ', verified: true });

    const ann = await stored('ann');
    expect(ann.profile.name).toBe('Annie');
    expect(ann.emails).toEqual([{ address: 'ann@example.com', verified: true }]);
  });

  it('shows the new username in the rankings at once', async () => {
    const game = await insertGame({ name: 'old game', winner: 'ann', winnerUserId: 'ann' });
    await insertPlayer(game._id, { userId: 'ann', name: 'ann' });
    await buildHighscores();

    await update({ name: 'Annie' });

    expect(await Highscores.find().fetchAsync()).toEqual([
      expect.objectContaining({ type: 'mostWon', name: 'Annie' }),
      expect.objectContaining({ type: 'mostPlayed', name: 'Annie' }),
    ]);
    // The game keeps the name it was played under.
    expect((await Games.findOneAsync(game._id)).winner).toBe('ann');
  });

  it('replaces the address with its verified flag, and leaves the name alone', async () => {
    await update({ email: ' annie@example.com ', verified: true });

    const ann = await stored('ann');
    expect(ann.emails).toEqual([{ address: 'annie@example.com', verified: true }]);
    expect(ann.profile.name).toBe('ann');
  });

  it('treats a change of case alone as no change of address', async () => {
    await update({ email: 'ANN@example.com', verified: true });

    expect((await stored('ann')).emails).toEqual([{ address: 'ann@example.com', verified: true }]);
  });

  it('refuses a blank name and writes nothing', async () => {
    await expect(update({ name: '   ', verified: true })).rejects.toMatchObject({ error: 400 });
    expect((await stored('ann')).emails[0].verified).toBe(false);
  });

  it('refuses a username another account holds, in any case, and writes nothing', async () => {
    await expect(update({ name: 'ADMIN', verified: true })).rejects.toMatchObject({
      error: 409,
      reason: 'That username is taken.',
    });
    const ann = await stored('ann');
    expect(ann.profile.name).toBe('ann');
    expect(ann.emails[0].verified).toBe(false);
  });

  it('refuses a username of the wrong shape', async () => {
    await expect(update({ name: 'Nobody' })).rejects.toMatchObject({ error: 400 });
    await expect(update({ name: 'an' })).rejects.toMatchObject({ error: 400 });
    await expect(update({ name: 'x'.repeat(21) })).rejects.toMatchObject({ error: 400 });
  });

  it('checks a change of case, and lets it through when it clashes with nobody else', async () => {
    await update({ name: 'Ann' });
    expect((await stored('ann')).profile.name).toBe('Ann');
  });

  // An older name can break today's rule; saving the account must not demand a rename.
  it('does not check an unchanged name, so an old short one still saves', async () => {
    await Meteor.users.updateAsync('ann', { $set: { 'profile.name': 'an' } });

    await update({ name: 'an', email: 'annie@example.com' });

    expect((await stored('ann')).emails[0].address).toBe('annie@example.com');
  });

  it('refuses an address without an @', async () => {
    await expect(update({ email: 'annie' })).rejects.toMatchObject({ error: 400 });
    expect((await stored('ann')).emails[0].address).toBe('ann@example.com');
  });

  it('refuses an address another account already holds, in any case', async () => {
    await Meteor.users.insertAsync({ _id: 'bob', emails: [{ address: 'Bob@Example.com' }] });

    await expect(update({ email: 'bob@example.com' })).rejects.toMatchObject({ error: 409 });
    expect((await stored('ann')).emails[0].address).toBe('ann@example.com');
  });

  describe("on the admin's own account", () => {
    const updateSelf = (fields) =>
      call('adminUpdateUser', {
        userId: 'admin',
        name: 'admin',
        email: ADMIN_EMAIL,
        verified: true,
        ...fields,
      });

    it('refuses an address outside ADMIN_EMAILS and writes nothing', async () => {
      await expect(updateSelf({ email: 'me@example.com', name: 'myself' })).rejects.toMatchObject({
        error: 409,
      });

      const admin = await stored('admin');
      expect(admin.emails[0].address).toBe(ADMIN_EMAIL);
      expect(admin.profile.name).toBe('admin');
    });

    it('refuses to clear its verified flag while VERIFY_EMAILS is on', async () => {
      await configure({ ADMIN_EMAILS: [ADMIN_EMAIL], VERIFY_EMAILS: true });

      await expect(updateSelf({ verified: false })).rejects.toMatchObject({ error: 409 });
      expect((await stored('admin')).emails[0].verified).toBe(true);
    });

    it('lets it clear its verified flag while VERIFY_EMAILS is off', async () => {
      await updateSelf({ verified: false });
      expect((await stored('admin')).emails[0].verified).toBe(false);
    });

    it('lets it move to another listed address', async () => {
      await asAdmin(['boss@example.com']);

      await updateSelf({ email: 'boss@example.com' });

      expect((await stored('admin')).emails[0].address).toBe('boss@example.com');
    });

    it('lets it rename itself', async () => {
      await updateSelf({ name: 'The Boss' });
      expect((await stored('admin')).profile.name).toBe('The Boss');
    });

    it("protects only the caller: another admin's address can leave the list", async () => {
      await asAdmin(['carl@example.com']);
      await Meteor.users.insertAsync({
        _id: 'carl',
        profile: { name: 'carl' },
        emails: [{ address: 'carl@example.com', verified: true }],
      });

      await call('adminUpdateUser', {
        userId: 'carl',
        name: 'carl',
        email: 'carl@elsewhere.com',
        verified: true,
      });

      expect((await stored('carl')).emails[0].address).toBe('carl@elsewhere.com');
    });
  });
});

describe('adminSetPassword', () => {
  beforeEach(async () => {
    await asAdmin();
    await insertAnn();
  });

  it('sets the password through accounts-password', async () => {
    await call('adminSetPassword', { userId: 'ann', password: 'secret1' });
    expect(accountsHooks().passwordsSet).toEqual([{ userId: 'ann', password: 'secret1' }]);
  });

  it("refuses a password shorter than the accounts panel's six characters", async () => {
    await expect(
      call('adminSetPassword', { userId: 'ann', password: '12345' })
    ).rejects.toMatchObject({ error: 400 });
    expect(accountsHooks().passwordsSet).toEqual([]);
  });

  it('refuses a password longer than accounts-password accepts', async () => {
    await expect(
      call('adminSetPassword', { userId: 'ann', password: 'x'.repeat(257) })
    ).rejects.toMatchObject({ error: 400 });
    expect(accountsHooks().passwordsSet).toEqual([]);
  });
});

describe('adminSendResetEmail', () => {
  beforeEach(async () => {
    await asAdmin();
    await insertAnn();
  });

  it('sends the reset email', async () => {
    await call('adminSendResetEmail', { userId: 'ann' });
    expect(accountsHooks().resetEmails).toEqual(['ann']);
  });

  it('refuses when the server cannot send mail', async () => {
    await withoutMail(async () => {
      await expect(call('adminSendResetEmail', { userId: 'ann' })).rejects.toMatchObject({
        error: 409,
      });
    });
    expect(accountsHooks().resetEmails).toEqual([]);
  });
});

describe('adminSendVerificationEmail', () => {
  beforeEach(() => asAdmin());

  it('sends the verification email for an unverified address', async () => {
    await insertAnn();
    await call('adminSendVerificationEmail', { userId: 'ann' });
    expect(accountsHooks().verificationEmails).toEqual(['ann']);
  });

  it('refuses when the address is already verified', async () => {
    await insertAnn({ emails: [{ address: 'ann@example.com', verified: true }] });

    await expect(call('adminSendVerificationEmail', { userId: 'ann' })).rejects.toMatchObject({
      error: 409,
    });
    expect(accountsHooks().verificationEmails).toEqual([]);
  });

  it('refuses when the server cannot send mail', async () => {
    await insertAnn();
    await withoutMail(async () => {
      await expect(call('adminSendVerificationEmail', { userId: 'ann' })).rejects.toMatchObject({
        error: 409,
      });
    });
    expect(accountsHooks().verificationEmails).toEqual([]);
  });
});

describe('adminLogoutUser', () => {
  it('drops every login token and leaves the rest of the account alone', async () => {
    await asAdmin();
    await insertAnn({
      services: {
        password: { bcrypt: 'hash' },
        resume: { loginTokens: [{ hashedToken: 'a' }, { hashedToken: 'b' }] },
      },
    });

    await call('adminLogoutUser', { userId: 'ann' });

    const ann = await stored('ann');
    expect(ann.services.resume.loginTokens).toEqual([]);
    expect(ann.services.password).toEqual({ bcrypt: 'hash' });
    expect(ann.emails[0].address).toBe('ann@example.com');
  });
});

describe('adminDeleteUser', () => {
  const remove = (userId = 'ann') => call('adminDeleteUser', { userId });
  const ranking = async (type) =>
    (await Highscores.find({ type }).fetchAsync())
      .sort((a, b) => a.rank - b.rank)
      .map(({ name, value }) => ({ name, value }));

  // A game that ended, as every end-of-game path leaves it: `winner` stamped with the
  // display name of the day, `winnerUserId` the account, and a player row per seat.
  async function finishedGame(winnerId, winnerName, seats = [[winnerId, winnerName]]) {
    const game = await insertGame({
      name: 'old game',
      userId: winnerId,
      winner: winnerName,
      winnerUserId: winnerId,
    });
    for (const [userId, name] of seats) await insertPlayer(game._id, { userId, name });
    return game;
  }

  beforeEach(() => asAdmin());

  it('deletes a user who was never in a game', async () => {
    await insertAnn();
    await remove();
    expect(await stored('ann')).toBeUndefined();
  });

  it("refuses the admin's own account, with its own message", async () => {
    // The caller is an admin too, so the self check has to answer before the admin one.
    await expect(remove('admin')).rejects.toMatchObject({
      error: 403,
      reason: "You can't delete your own account.",
    });
    expect(await stored('admin')).toBeDefined();
  });

  it('refuses another admin', async () => {
    await asAdmin(['carl@example.com']);
    await Meteor.users.insertAsync({
      _id: 'carl',
      emails: [{ address: 'carl@example.com', verified: true }],
    });

    await expect(remove('carl')).rejects.toMatchObject({
      error: 403,
      reason: 'That account is an admin. Remove its address from ADMIN_EMAILS first.',
    });
    expect(await stored('carl')).toBeDefined();
  });

  it('refuses a user who owns a lobby, naming the game', async () => {
    await insertAnn();
    await insertGame({ name: 'Friday lobby', userId: 'ann', started: false });

    await expect(remove()).rejects.toMatchObject({ error: 409 });
    await expect(remove()).rejects.toThrow('"Friday lobby"');
    expect(await stored('ann')).toBeDefined();
  });

  it("refuses a user seated in somebody else's running game", async () => {
    await insertAnn();
    const game = await insertGame({ name: 'Race', userId: 'bob' });
    await insertPlayer(game._id, { userId: 'ann', name: 'ann' });

    await expect(remove()).rejects.toMatchObject({ error: 409 });
    expect(await stored('ann')).toBeDefined();
  });

  it('deletes a user whose games are all over, and keeps those games and rows', async () => {
    await insertAnn();
    const won = await finishedGame('ann', 'ann');
    const lost = await insertGame({ name: 'lost', userId: 'bob', winner: 'Nobody' });
    await insertPlayer(lost._id, { userId: 'ann', name: 'ann' });

    await remove();

    expect(await stored('ann')).toBeUndefined();
    expect(await Games.findOneAsync(won._id)).toBeDefined();
    expect(await Players.find({ userId: 'ann' }).countAsync()).toBe(2);
  });

  // The rows still say 'ann'; the account was renamed since, and that last name is the one
  // to keep once nothing is left to read it from.
  it("stamps the account's last name on every row that names it, and on nobody else's", async () => {
    await insertAnn({ profile: { name: 'Annie' } });
    const won = await finishedGame('ann', 'ann', [
      ['ann', 'ann'],
      ['bob', 'bob'],
    ]);
    const lost = await insertGame({
      userId: 'bob',
      author: 'bob',
      winner: 'bob',
      winnerUserId: 'bob',
    });
    await insertPlayer(lost._id, { userId: 'ann', name: 'ann' });
    const line = (fields) =>
      Chat.insertAsync({ gameId: 'global', message: 'hi', submitted: 1, ...fields });
    await line({ userId: 'ann', author: 'ann' });
    await line({ userId: 'bob', author: 'bob' });
    await line({ gameId: won._id, message: 'Game over' });

    await remove();

    const authors = (await Chat.find({}).fetchAsync()).map((c) => c.author);
    expect(authors).toEqual(['Annie', 'bob', undefined]);
    const seats = (await Players.find({}).fetchAsync()).map((p) => [p.userId, p.name]);
    expect(seats).toEqual([
      ['ann', 'Annie'],
      ['bob', 'bob'],
      ['ann', 'Annie'],
    ]);
    expect(await Games.findOneAsync(won._id)).toMatchObject({ author: 'Annie', winner: 'Annie' });
    expect(await Games.findOneAsync(lost._id)).toMatchObject({ author: 'bob', winner: 'bob' });
  });

  // No `buildHighscores()` after the delete: the method rebuilds the rankings itself.
  it('drops the user from the rankings at once, and the next one moves up', async () => {
    await insertAnn();
    await Meteor.users.insertAsync({ _id: 'bob', profile: { name: 'bob' } });
    await finishedGame('ann', 'ann');
    await finishedGame('ann', 'ann');
    await finishedGame('bob', 'bob');
    await buildHighscores();
    expect(await ranking('mostWon')).toEqual([
      { name: 'ann', value: 2 },
      { name: 'bob', value: 1 },
    ]);

    await remove();

    expect(await ranking('mostWon')).toEqual([{ name: 'bob', value: 1 }]);
    expect(await ranking('mostPlayed')).toEqual([{ name: 'bob', value: 1 }]);
    expect(await Games.find({ winnerUserId: 'ann' }).countAsync()).toBe(2);
  });
});

describe('adminCreateUser', () => {
  const create = (fields) =>
    call('adminCreateUser', {
      name: '',
      email: 'new@example.com',
      password: 'secret1',
      verified: false,
      ...fields,
    });
  const byEmail = (address) => Accounts.findUserByEmail(address);

  // The real startup block, so `onCreateUser` and the allowlist hook are both live.
  async function asAdminWith(settings = {}) {
    await configure({ ADMIN_EMAILS: [ADMIN_EMAIL], ...settings });
    await loginAs({ _id: 'admin', emails: [{ address: ADMIN_EMAIL, verified: true }] });
  }

  it('refuses an anonymous caller and a player, and creates nothing', async () => {
    await asAdminWith();
    logout();
    await expect(create()).rejects.toMatchObject({ error: 401 });
    await loginAs({ _id: 'player', emails: [{ address: 'player@example.com', verified: true }] });
    await expect(create()).rejects.toMatchObject({ error: 403 });

    expect(await byEmail('new@example.com')).toBeUndefined();
  });

  it('stores a typed username, trimmed', async () => {
    await asAdminWith();
    const id = await create({ name: '  Newcomer ' });
    expect((await stored(id)).profile.name).toBe('Newcomer');
  });

  it('refuses a typed username of the wrong shape or taken, and creates nothing', async () => {
    await asAdminWith();
    await insertAnn();

    await expect(create({ name: 'ab' })).rejects.toMatchObject({ error: 400 });
    await expect(create({ name: 'Nobody' })).rejects.toMatchObject({ error: 400 });
    await expect(create({ name: 'ANN' })).rejects.toMatchObject({
      error: 409,
      reason: 'That username is taken.',
    });
    expect(await byEmail('new@example.com')).toBeUndefined();
  });

  it('says so when the username from the email cannot be used', async () => {
    await asAdminWith();
    await insertAnn();

    await expect(create({ email: 'ann@elsewhere.org' })).rejects.toMatchObject({
      error: 409,
      reason:
        'The username "ann" from the email cannot be used: That username is taken. Type one instead.',
    });
    await expect(create({ email: 'ab@example.com' })).rejects.toMatchObject({ error: 400 });
    expect(await byEmail('ann@elsewhere.org')).toBeUndefined();
  });

  it('creates the account with its password and returns its id', async () => {
    await asAdminWith();

    const id = await create({ email: '  New@Example.COM ' });

    const user = await stored(id);
    expect(user.emails).toEqual([{ address: 'new@example.com', verified: false }]);
    expect(user.profile.name).toBe('new');
    expect(user.services.password).toBeDefined();
    expect(accountsHooks().resetEmails).toEqual([]);
  });

  it('marks the address verified when asked', async () => {
    await asAdminWith();
    const id = await create({ verified: true });
    expect((await stored(id)).emails[0].verified).toBe(true);
  });

  it('with no password, creates the account without one and sends the reset email', async () => {
    await asAdminWith();

    const id = await create({ password: '' });

    expect((await stored(id)).services.password).toBeUndefined();
    expect(accountsHooks().resetEmails).toEqual([id]);
  });

  it('refuses no password when the server cannot send mail, and creates nothing', async () => {
    await asAdminWith();

    await withoutMail(async () => {
      await expect(create({ password: '' })).rejects.toMatchObject({ error: 409 });
    });
    expect(await byEmail('new@example.com')).toBeUndefined();
  });

  it('refuses a bad address, a short password and a long one', async () => {
    await asAdminWith();

    await expect(create({ email: 'nobody' })).rejects.toMatchObject({ error: 400 });
    await expect(create({ password: '12345' })).rejects.toMatchObject({ error: 400 });
    await expect(create({ password: 'x'.repeat(257) })).rejects.toMatchObject({ error: 400 });
    expect(await byEmail('new@example.com')).toBeUndefined();
  });

  it('refuses an address that already has an account, in any case', async () => {
    await asAdminWith();
    await insertAnn();

    await expect(create({ email: 'ANN@example.com' })).rejects.toMatchObject({ error: 409 });
  });

  describe('and the sign-up allowlist', () => {
    const signUp = (email) => Accounts.createUserAsync({ email, password: 'secret1' });

    it('lets an admin add an address the allowlist refuses at sign-up', async () => {
      await asAdminWith({ ALLOWED_EMAILS: ['friend@example.com'] });

      const id = await create({ email: 'outsider@example.com' });

      expect((await stored(id)).emails[0].address).toBe('outsider@example.com');
      await expect(signUp('outsider2@example.com')).rejects.toMatchObject({ error: 403 });
    });

    it('lets nothing else through while an admin creation is running', async () => {
      await asAdminWith({ ALLOWED_EMAILS: ['friend@example.com'] });
      // A hook after the allowlist holds the admin's creation inside its window, so the
      // stranger's sign-up is judged while the admin's value is set. A shared flag would
      // let the stranger through here; a value scoped to the creation does not.
      let paused;
      const inWindow = new Promise((resolve) => (paused = resolve));
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      accountsHooks().validateNewUser.push(async (user) => {
        if (user.emails[0].address === 'outsider@example.com') {
          paused();
          await gate;
        }
        return true;
      });

      const admin = create({ email: 'outsider@example.com' });
      await inWindow;
      const stranger = await signUp('stranger@example.com').catch((error) => error);
      release();

      expect(stranger).toMatchObject({ error: 403 });
      await expect(admin).resolves.toEqual(expect.any(String));
      expect(await byEmail('stranger@example.com')).toBeUndefined();
    });
  });
});

describe('adminAccountIds', () => {
  it('refuses a player', async () => {
    setSettings({ ADMIN_EMAILS: [ADMIN_EMAIL] });
    await loginAs({ _id: 'player', emails: [{ address: 'player@example.com', verified: true }] });
    await expect(call('adminAccountIds')).rejects.toMatchObject({ error: 403 });
  });

  it('names every account the admin rule says yes to, and no other', async () => {
    await asAdmin(['carl@example.com']);
    await insertAnn();
    await Meteor.users.insertAsync({
      _id: 'carl',
      emails: [{ address: 'Carl@Example.com', verified: false }],
    });

    expect((await call('adminAccountIds')).sort()).toEqual(['admin', 'carl']);
  });

  it('follows the verified rule while VERIFY_EMAILS is on', async () => {
    await configure({ ADMIN_EMAILS: [ADMIN_EMAIL, 'carl@example.com'], VERIFY_EMAILS: true });
    await loginAs({ _id: 'admin', emails: [{ address: ADMIN_EMAIL, verified: true }] });
    await Meteor.users.insertAsync({
      _id: 'carl',
      emails: [{ address: 'carl@example.com', verified: false }],
    });

    expect(await call('adminAccountIds')).toEqual(['admin']);
  });
});
