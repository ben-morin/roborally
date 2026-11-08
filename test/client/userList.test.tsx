// @vitest-environment jsdom
// The user manager's list, on the real `/admin/users` route with an admin signed in: what a
// row says about its user, the filter, the loading hold, and that picking a row puts the
// user in the URL.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AdminUsers } from '../../client/views/admin/AdminUsers.ts';
import { routes } from '../../client/views/router.tsx';
import { loginAs, logout, resetFakeCollections, setSettings } from '../setup.js';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

const DAY = 86_400_000;

// The admin signs in through `Meteor.users`, which is also where the server's methods look.
// The list itself reads the `adminUsers` publication's own client collection.
const ADMIN = {
  _id: 'admin',
  profile: { name: 'admin' },
  emails: [{ address: 'admin@example.com', verified: true }],
  createdAt: new Date(Date.now() - 30 * DAY),
  status: { online: true, lastLogin: { date: new Date(Date.now() - DAY) } },
};

beforeEach(async () => {
  resetFakeCollections();
  setSubscriptionsLoading(false);
  setSettings({ ADMIN_EMAILS: ['admin@example.com'] });
  logout();
  await loginAs(ADMIN);
  await AdminUsers.insertAsync(ADMIN);
  await AdminUsers.insertAsync({
    _id: 'ann',
    profile: { name: 'ann' },
    emails: [{ address: 'ann@example.com', verified: false }],
    createdAt: new Date(Date.now() - 2 * DAY),
    status: { online: true, idle: true },
  });
  await AdminUsers.insertAsync({
    _id: 'bob',
    profile: { name: 'bob' },
    emails: [{ address: 'bob@other.org', verified: true }],
    createdAt: new Date(Date.now() - 5 * DAY),
  });
});
afterEach(() => {
  cleanup();
  setSettings();
});

async function open(path = '/admin/users') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Users' });
  // Lets the admin-ids answer land too.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return router;
}

const row = (name: string) =>
  screen.getAllByRole('button').find((b) => within(b).queryByText(name, { selector: '.name' }))!;
const names = () =>
  Array.from(document.querySelectorAll('[data-user] .name')).map((n) => n.textContent);

describe('the user list', () => {
  it('lists every account by name, with a count', async () => {
    await open();

    expect(names()).toEqual(['admin', 'ann', 'bob']);
    expect(screen.getByText('3 users')).toBeVisible();
  });

  it('shows the address, the admin and unverified marks, and presence', async () => {
    await open();

    expect(within(row('admin')).getByText('admin', { selector: 'span' })).toBeVisible();
    expect(within(row('admin')).getByText('online')).toBeVisible();
    expect(within(row('admin')).queryByText('unverified')).toBeNull();

    expect(within(row('ann')).getByText('ann@example.com')).toBeVisible();
    expect(within(row('ann')).getByText('unverified')).toBeVisible();
    expect(within(row('ann')).getByText('idle')).toBeVisible();
    expect(within(row('ann')).queryByText('admin', { selector: 'span' })).toBeNull();

    expect(within(row('bob')).getByText('offline')).toBeVisible();
  });

  it('says when each account joined and last logged in', async () => {
    await open();

    expect(row('admin')).toHaveTextContent('joined last month · last login yesterday');
    expect(row('bob')).toHaveTextContent('joined 5 days ago · never logged in');
  });

  it('filters on name or address, ignoring case', async () => {
    await open();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter users' }), {
      target: { value: 'OTHER.org' },
    });
    expect(names()).toEqual(['bob']);
    expect(screen.getByText('1 of 3 users')).toBeVisible();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter users' }), {
      target: { value: 'nobody' },
    });
    expect(screen.getByText('No users match.')).toBeVisible();
  });

  it('holds the list back until the publication is ready', async () => {
    setSubscriptionsLoading(true);
    const router = createMemoryRouter(routes, { initialEntries: ['/admin/users'] });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Users' });

    expect(screen.getByText('Loading...')).toBeVisible();
    expect(names()).toEqual([]);
  });

  it('puts a clicked or keyed user in the URL and marks the row', async () => {
    const router = await open();

    fireEvent.click(row('ann'));
    expect(router.state.location.search).toBe('?user=ann');
    expect(row('ann')).toHaveAttribute('aria-pressed', 'true');
    expect(row('bob')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(row('bob'), { key: 'Enter' });
    expect(router.state.location.search).toBe('?user=bob');
    fireEvent.keyDown(row('ann'), { key: ' ' });
    expect(router.state.location.search).toBe('?user=ann');
  });

  it('opens with the user from the URL selected', async () => {
    await open('/admin/users?user=bob');
    expect(row('bob')).toHaveAttribute('aria-pressed', 'true');
  });
});
