// @vitest-environment jsdom
// The user manager's Add user form, on the real `/admin/users` route with an admin signed in.
// Create runs the real `adminCreateUser` in the server harness, so a test reads the account
// the server made; only the dialogs are replaced.
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
import { modalAlert } from '../../client/helper/modalDialogs.ts';
import { routes } from '../../client/views/router.tsx';
import {
  accountsHooks,
  loginAs,
  logout,
  resetAccounts,
  resetFakeCollections,
  setSettings,
} from '../setup.js';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

beforeEach(async () => {
  resetFakeCollections();
  resetAccounts();
  setSubscriptionsLoading(false);
  setSettings({ ADMIN_EMAILS: ['admin@example.com'] });
  logout();
  await loginAs({ _id: 'admin', emails: [{ address: 'admin@example.com', verified: true }] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setSettings();
});

async function open(path = '/admin/users') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Users' });
  // Lets the admin-ids and mail answers land.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return router;
}

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const createdUser = () => Accounts.findUserByEmail('new@example.com');

describe('Add user', () => {
  it('opens the form from the button above the list', async () => {
    const router = await open();

    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));

    expect(router.state.location.search).toBe('?user=new');
    expect(screen.getByRole('form', { name: 'Add user' })).toBeVisible();
  });

  it('creates the account with a password and opens it', async () => {
    const router = await open('/admin/users?user=new');

    fill('Email', 'new@example.com');
    fill('Password', 'secret1');
    fireEvent.click(screen.getByLabelText('Email verified'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await vi.waitFor(() =>
      expect(modalAlert).toHaveBeenCalledWith('new@example.com can sign in now.')
    );
    const user = (await createdUser())!;
    expect(user.emails).toEqual([{ address: 'new@example.com', verified: true }]);
    expect(router.state.location.search).toBe(`?user=${user._id}`);
    expect(accountsHooks().resetEmails).toEqual([]);
  });

  it('with no password, sends the reset email so they choose their own', async () => {
    await open('/admin/users?user=new');
    expect(screen.getByText(/Leave it empty to email them a link/)).toBeVisible();

    fill('Email', 'new@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await vi.waitFor(() =>
      expect(modalAlert).toHaveBeenCalledWith(
        'A password reset email is on its way to new@example.com, to choose a password.'
      )
    );
    expect(accountsHooks().resetEmails).toEqual([(await createdUser())!._id]);
  });

  it('needs a password when the server cannot send mail', async () => {
    const previous = process.env.MAIL_URL;
    delete process.env.MAIL_URL;
    Meteor.isDevelopment = false;
    try {
      await open('/admin/users?user=new');

      expect(screen.getByLabelText('Password')).toBeRequired();
      expect(screen.getByText(/so a password is needed/)).toBeVisible();
      fill('Email', 'new@example.com');
      fireEvent.submit(screen.getByRole('form', { name: 'Add user' }));

      await vi.waitFor(() =>
        expect(modalAlert).toHaveBeenCalledWith(
          'Email is not set up on this server. Type a password instead.'
        )
      );
      expect(await createdUser()).toBeUndefined();
    } finally {
      Meteor.isDevelopment = true;
      if (previous !== undefined) process.env.MAIL_URL = previous;
    }
  });

  it("shows the server's refusal and stays on the form", async () => {
    const router = await open('/admin/users?user=new');

    fill('Email', 'admin@example.com');
    fill('Password', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await vi.waitFor(() =>
      expect(modalAlert).toHaveBeenCalledWith('An account with that email address already exists.')
    );
    expect(router.state.location.search).toBe('?user=new');
  });

  it('Cancel goes back to no selection', async () => {
    const router = await open('/admin/users?user=new');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(router.state.location.search).toBe('');
    expect(screen.getByText('Pick a user')).toBeVisible();
  });
});
