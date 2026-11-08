// @vitest-environment jsdom
// The user manager's detail panel, on the real `/admin/users` route with an admin signed in.
// Each button runs the real admin method in the server harness, so a test reads what the
// server wrote; only the dialogs are replaced, so a test can answer a confirm and read an
// alert.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.ts', async (importOriginal) => ({
  // The layout's <Modal> still needs the queue's own exports.
  ...(await importOriginal<typeof import('../../client/helper/modalDialogs.ts')>()),
  modalAlert: vi.fn(async () => true),
  modalConfirm: vi.fn(async () => true),
}));

import { createMemoryRouter, RouterProvider } from 'react-router';
import { modalAlert, modalConfirm } from '../../client/helper/modalDialogs.ts';
import { AdminUsers } from '../../client/views/admin/AdminUsers.ts';
import { routes } from '../../client/views/router.tsx';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import {
  accountsHooks,
  loginAs,
  logout,
  resetAccounts,
  resetFakeCollections,
  setSettings,
} from '../setup.js';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

const ADMIN = {
  _id: 'admin',
  profile: { name: 'admin' },
  emails: [{ address: 'admin@example.com', verified: true }],
};
const ANN = {
  _id: 'ann',
  profile: { name: 'ann' },
  emails: [{ address: 'ann@example.com', verified: false }],
  services: { resume: { loginTokens: [{ hashedToken: 't' }] } },
};

// The server's methods read `Meteor.users`; the page reads the publication's own collection.
// Both get the same account, as the real publication would make it.
async function seat({ services, ...published }: typeof ADMIN & { services?: object }) {
  if (!(await Meteor.users.findOneAsync(published._id))) {
    await Meteor.users.insertAsync(services ? { ...published, services } : published);
  }
  await AdminUsers.insertAsync(published);
}

beforeEach(async () => {
  resetFakeCollections();
  resetAccounts();
  setSubscriptionsLoading(false);
  setSettings({ ADMIN_EMAILS: ['admin@example.com', 'carl@example.com'] });
  logout();
  await loginAs(ADMIN);
  await seat(ADMIN);
  await seat(ANN);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setSettings();
});

async function open(userId?: string) {
  const path = userId ? `/admin/users?user=${userId}` : '/admin/users';
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Users' });
  // Lets the admin-ids and mail answers land.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return router;
}

const stored = (id: string) => Meteor.users.findOneAsync(id);
const button = (name: string) => screen.getByRole('button', { name });

describe('the detail panel', () => {
  it('asks for a user until one is picked', async () => {
    await open();
    expect(screen.getByText('Pick a user')).toBeVisible();
  });

  it("shows the picked user's name, address and verified flag, ready to edit", async () => {
    await open('ann');

    expect(screen.getByRole('heading', { name: /ann/ })).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('ann');
    expect(screen.getByLabelText('Email')).toHaveValue('ann@example.com');
    expect(screen.getByLabelText('Email verified')).not.toBeChecked();
  });

  // The changed row is the answer; only a refusal gets a dialog.
  it('saves the name, address and verified flag, with no dialog', async () => {
    await open('ann');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Annie' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'annie@example.com' } });
    fireEvent.click(screen.getByLabelText('Email verified'));
    fireEvent.click(button('Save'));

    await vi.waitFor(async () => expect((await stored('ann'))!.profile!.name).toBe('Annie'));
    expect((await stored('ann'))!.emails).toEqual([
      { address: 'annie@example.com', verified: true },
    ]);
    expect(modalAlert).not.toHaveBeenCalled();
  });

  it("shows the server's refusal as it is worded", async () => {
    await open('ann');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    fireEvent.click(button('Save'));

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Name is required.'));
    expect((await stored('ann'))!.profile!.name).toBe('ann');
  });

  it('sets a password and clears the field', async () => {
    await open('ann');

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'secret1' } });
    fireEvent.click(button('Set password'));

    await vi.waitFor(() =>
      expect(modalAlert).toHaveBeenCalledWith('Password set. ann is signed out everywhere.')
    );
    expect(accountsHooks().passwordsSet).toEqual([{ userId: 'ann', password: 'secret1' }]);
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(modalConfirm).not.toHaveBeenCalled();
  });

  it('asks before an admin sets their own password, since it signs them out', async () => {
    vi.mocked(modalConfirm).mockResolvedValueOnce(false);
    await open('admin');

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'secret1' } });
    fireEvent.click(button('Set password'));

    await vi.waitFor(() => expect(modalConfirm).toHaveBeenCalled());
    expect(accountsHooks().passwordsSet).toEqual([]);
  });

  it('sends the reset email and, for an unverified address, the verification email', async () => {
    await open('ann');

    fireEvent.click(button('Send password reset email'));
    await vi.waitFor(() => expect(accountsHooks().resetEmails).toEqual(['ann']));

    fireEvent.click(button('Send verification email'));
    await vi.waitFor(() => expect(accountsHooks().verificationEmails).toEqual(['ann']));
  });

  it('offers no verification email for a verified address', async () => {
    await open('admin');
    expect(screen.queryByRole('button', { name: 'Send verification email' })).toBeNull();
  });

  it('offers no email at all when the server cannot send it', async () => {
    const previous = process.env.MAIL_URL;
    delete process.env.MAIL_URL;
    Meteor.isDevelopment = false;
    try {
      await open('ann');

      expect(button('Send password reset email')).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Send verification email' })).toBeNull();
      expect(screen.getByText('Email is not set up on this server.')).toBeVisible();
    } finally {
      Meteor.isDevelopment = true;
      if (previous !== undefined) process.env.MAIL_URL = previous;
    }
  });

  it('signs a user out everywhere after asking', async () => {
    await open('ann');

    fireEvent.click(button('Sign out everywhere'));

    await vi.waitFor(() =>
      expect(modalAlert).toHaveBeenCalledWith('ann is signed out everywhere.')
    );
    expect(modalConfirm).toHaveBeenCalledWith('Sign ann out everywhere?');
    expect((await stored('ann'))?.services).toEqual({ resume: { loginTokens: [] } });
  });

  describe('Delete user', () => {
    it('does nothing when the confirm is declined', async () => {
      vi.mocked(modalConfirm).mockResolvedValueOnce(false);
      await open('ann');

      fireEvent.click(button('Delete user'));

      await vi.waitFor(() => expect(modalConfirm).toHaveBeenCalled());
      expect(await stored('ann')).toBeDefined();
    });

    // The confirm was the admin's say; no second dialog repeats it.
    it('deletes after the confirm and clears the selection, with nothing more to dismiss', async () => {
      const router = await open('ann');

      fireEvent.click(button('Delete user'));

      await vi.waitFor(() => expect(router.state.location.search).toBe(''));
      await vi.waitFor(async () => expect(await stored('ann')).toBeUndefined());
      expect(modalConfirm).toHaveBeenCalledTimes(1);
      expect(modalAlert).not.toHaveBeenCalled();
    });

    it("shows the server's refusal for a user still in a game", async () => {
      const game = await insertGame({ name: 'Race', userId: 'bob' });
      await insertPlayer(game!._id, { userId: 'ann', name: 'ann' });
      await open('ann');

      fireEvent.click(button('Delete user'));

      await vi.waitFor(() =>
        expect(modalAlert).toHaveBeenCalledWith(expect.stringContaining('"Race"'))
      );
      expect(await stored('ann')).toBeDefined();
    });

    it("is not offered on the admin's own account", async () => {
      await open('admin');

      expect(screen.queryByRole('button', { name: 'Delete user' })).toBeNull();
      expect(screen.getByText('You cannot delete your own account.')).toBeVisible();
    });

    it('is not offered on another admin', async () => {
      await seat({
        _id: 'carl',
        profile: { name: 'carl' },
        emails: [{ address: 'carl@example.com', verified: true }],
      });
      await open('carl');

      expect(screen.queryByRole('button', { name: 'Delete user' })).toBeNull();
      expect(screen.getByText(/Remove the address from ADMIN_EMAILS first/)).toBeVisible();
    });
  });
});
