// Usernames are unique: one rule (`checkNameAsync` over the shape in both/displayName.ts),
// enforced for every new account by its own `validateNewUser` hook, and a startup warning for
// any repeat from before the rule.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import {
  accountsHooks,
  resetAccounts,
  resetFakeCollections,
  runStartup,
  setSettings,
} from '../setup.js';
import { adminCreatingUser, checkNameAsync } from '../../both/permissions.ts';

async function startup(settings = {}) {
  resetAccounts();
  setSettings(settings);
  await runStartup();
}

// The username hook, as Meteor would run it: after `onCreateUser` put the name on.
const newName = () => accountsHooks().validateNewUser[1];
const account = (_id, name) => ({
  _id,
  profile: { name },
  emails: [{ address: `${_id}@example.com` }],
});

beforeEach(() => resetFakeCollections());
afterEach(() => {
  vi.restoreAllMocks();
  setSettings();
});

describe('checkNameAsync', () => {
  beforeEach(() => Meteor.users.insertAsync(account('ann', 'Ann')));

  it('returns a free name, trimmed', async () => {
    expect(await checkNameAsync('  Benjamin ')).toBe('Benjamin');
  });

  it('refuses a name another account holds, ignoring case', async () => {
    await expect(checkNameAsync('ANN')).rejects.toMatchObject({
      error: 409,
      reason: 'That username is taken.',
    });
  });

  it('does not count the account it is checking for', async () => {
    expect(await checkNameAsync('ann', 'ann')).toBe('ann');
  });

  it('counts an account with no stored name by the name its address gives', async () => {
    await Meteor.users.insertAsync({ _id: 'old', emails: [{ address: 'Oldtimer@example.com' }] });
    await expect(checkNameAsync('oldtimer')).rejects.toMatchObject({ error: 409 });
  });

  it('refuses the wrong shape with 400 and the shape rule message', async () => {
    await expect(checkNameAsync('ab')).rejects.toMatchObject({
      error: 400,
      reason: 'Username must be 3 to 20 characters long.',
    });
    await expect(checkNameAsync('nobody')).rejects.toMatchObject({ error: 400 });
  });
});

describe('the username hook on every new account', () => {
  beforeEach(async () => {
    await startup();
    await Meteor.users.insertAsync(account('ann', 'Ann'));
  });

  it('lets a free, well-shaped name through', async () => {
    expect(await newName()(account('u2', 'Benjamin'))).toBe(true);
  });

  it('refuses a taken name, a bad shape, and no name at all', async () => {
    await expect(newName()(account('u2', 'ann'))).rejects.toMatchObject({ error: 409 });
    await expect(newName()(account('u2', 'Nobody'))).rejects.toMatchObject({ error: 400 });
    await expect(newName()({ _id: 'u2' })).rejects.toMatchObject({ error: 400 });
  });

  // The allowlist hook returns early for an admin's creation; this one must not.
  it('still applies while an admin is creating the account', async () => {
    await expect(
      adminCreatingUser.withValue(true, () => newName()(account('u2', 'ANN')))
    ).rejects.toMatchObject({ error: 409 });
  });

  it('refuses a second sign-up whose address derives a taken name', async () => {
    const created = accountsHooks().onCreateUser[0](
      {},
      { _id: 'u2', emails: [{ address: 'ann@elsewhere.org' }] }
    );
    await expect(newName()(created)).rejects.toMatchObject({ error: 409 });
  });
});

describe('startup warning for repeated usernames', () => {
  const warnings = () =>
    vi
      .mocked(console.warn)
      .mock.calls.map(([line]) => String(line))
      .filter((line) => line.startsWith('The username'));

  beforeEach(() => vi.spyOn(console, 'warn'));

  it('names each name more than one account holds, ignoring case', async () => {
    await Meteor.users.insertAsync(account('a1', 'Ben'));
    await Meteor.users.insertAsync(account('a2', 'ben'));
    await Meteor.users.insertAsync(account('a3', 'BEN'));
    await Meteor.users.insertAsync(account('a4', 'Ann'));

    await startup();

    expect(warnings()).toEqual([
      'The username "ben" belongs to 3 accounts. Usernames are unique now: rename all but one on the admin screen.',
    ]);
  });

  it('stays quiet when every name is unique', async () => {
    await Meteor.users.insertAsync(account('a1', 'Ben'));
    await Meteor.users.insertAsync(account('a2', 'Ann'));

    await startup();

    expect(warnings()).toEqual([]);
  });
});
