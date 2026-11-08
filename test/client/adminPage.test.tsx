// @vitest-environment jsdom
// The way in to the admin screens: the navbar link only an admin sees, and the `/admin`
// shell that sends anybody else to the game list. Driven through the real route table, and
// through the real `isAdmin` method in the server harness, so the answer comes from the same
// `ADMIN_EMAILS` rule the server enforces.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../../client/views/router.tsx';
import { loginAs, logout, resetFakeCollections, setSettings } from '../setup.js';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

const ADMIN = { _id: 'admin', emails: [{ address: 'admin@example.com', verified: true }] };
const PLAYER = { _id: 'player', emails: [{ address: 'player@example.com', verified: true }] };

beforeEach(() => {
  resetFakeCollections();
  setSubscriptionsLoading(false);
  // The chat scrolls its message list on mount; jsdom has no scrollTo.
  Element.prototype.scrollTo = () => {};
  setSettings({ ADMIN_EMAILS: ['admin@example.com'] });
  logout();
});
afterEach(() => {
  cleanup();
  setSettings();
});

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

// The answer arrives after a round trip through the method harness; this lets it land.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('the Admin link', () => {
  it('shows for an admin and points at /admin', async () => {
    await loginAs(ADMIN);
    open('/');

    expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('never shows for a player', async () => {
    await loginAs(PLAYER);
    open('/');
    await settle();

    expect(screen.getByRole('link', { name: 'Ranking' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('is marked current on an admin screen', async () => {
    await loginAs(ADMIN);
    open('/admin/users');

    expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

describe('/admin', () => {
  it('lands an admin on the users screen', async () => {
    await loginAs(ADMIN);
    const router = open('/admin');

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/admin/users');
  });

  it('shows Loading until the server has answered', async () => {
    await loginAs(ADMIN);
    open('/admin/users');

    expect(screen.getByText('Loading...')).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeVisible();
  });

  it('lists the admin screens as links, with the current one marked', async () => {
    await loginAs(ADMIN);
    open('/admin/users');

    const nav = await screen.findByRole('navigation', { name: 'Admin screens' });
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('sends a player to the game list', async () => {
    await loginAs(PLAYER);
    const router = open('/admin/users');
    await settle();

    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('navigation', { name: 'Admin screens' })).toBeNull();
  });

  it('shows a visitor the landing card, as every page does', () => {
    open('/admin/users');

    expect(screen.getByRole('heading', { level: 2, name: 'roborally' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Admin screens' })).toBeNull();
  });
});
