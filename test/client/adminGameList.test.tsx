// @vitest-environment jsdom
// The games manager's list, on the real `/admin/games` route with an admin signed in: what a
// row says about its game, the state and text filters, the loading hold, the pages, and that
// picking a row puts the game in the URL.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AdminGames, AdminPlayers } from '../../client/views/admin/AdminGames.ts';
import { AdminUsers } from '../../client/views/admin/AdminUsers.ts';
import { routes } from '../../client/views/router.tsx';
import type { AdminGameDoc } from '../../client/lib/adminGames.ts';
import { loginAs, logout, resetFakeCollections, setSettings } from '../setup.js';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

const MINUTE = 60_000;
const ADMIN = {
  _id: 'admin',
  profile: { name: 'admin' },
  emails: [{ address: 'admin@example.com', verified: true }],
};

function game(fields: Partial<AdminGameDoc> & { _id: string; name: string }): AdminGameDoc {
  return {
    userId: 'ann',
    author: 'ann',
    submitted: Date.now() - 60 * MINUTE,
    started: true,
    gamePhase: 'program',
    playPhase: 'waiting',
    programRound: 4,
    boardName: 'checkmate',
    min_player: 1,
    max_player: 8,
    lastStepAt: new Date(Date.now() - 5 * MINUTE),
    ...fields,
  };
}

// Newest first: the lobby, the live race, the parked one, then two that are over.
beforeEach(async () => {
  resetFakeCollections();
  setSubscriptionsLoading(false);
  setSettings({ ADMIN_EMAILS: ['admin@example.com'] });
  logout();
  await loginAs(ADMIN);
  await AdminUsers.insertAsync(ADMIN);
  await AdminUsers.insertAsync({ _id: 'ann', profile: { name: 'ann' }, status: { online: true } });
  await AdminUsers.insertAsync({ _id: 'bob', profile: { name: 'bob' } });
  await AdminGames.insertAsync(
    game({
      _id: 'lobby',
      name: 'Lobby',
      started: false,
      gamePhase: 'waiting',
      submitted: Date.now() - MINUTE,
    })
  );
  await AdminGames.insertAsync(
    game({ _id: 'race', name: 'Race', submitted: Date.now() - 2 * MINUTE })
  );
  await AdminGames.insertAsync(
    game({
      _id: 'stuck',
      name: 'Stuck',
      boardName: 'exchange',
      resumeAttempts: 3,
      submitted: Date.now() - 3 * MINUTE,
    })
  );
  await AdminGames.insertAsync(
    game({
      _id: 'won',
      name: 'Won',
      gamePhase: 'game ended',
      winner: 'bob',
      winnerUserId: 'bob',
      stopped: Date.now() - 10 * MINUTE,
      submitted: Date.now() - 4 * MINUTE,
    })
  );
  await AdminGames.insertAsync(
    game({
      _id: 'nobody',
      name: 'Abandoned',
      gamePhase: 'game ended',
      winner: 'Nobody',
      submitted: Date.now() - 5 * MINUTE,
    })
  );
  await AdminPlayers.insertAsync({ _id: 'p1', gameId: 'race', userId: 'ann', name: 'ann' });
  await AdminPlayers.insertAsync({ _id: 'p2', gameId: 'race', userId: 'bob', name: 'bob' });
  await AdminPlayers.insertAsync({ _id: 'p3', gameId: 'lobby', userId: 'ann', name: 'ann' });
  await AdminPlayers.insertAsync({ _id: 'p4', gameId: 'stuck', userId: 'carl', name: 'Carl' });
});
afterEach(() => {
  cleanup();
  setSettings();
});

async function open(path = '/admin/games') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Games' });
  return router;
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-game="${id}"]`)!;
const names = () =>
  Array.from(document.querySelectorAll('[data-game] .name')).map((n) => n.textContent);
const showing = (label: string) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Show games' })).getByRole('button', {
      name: new RegExp(`^${label}`),
    })
  );

describe('the game list', () => {
  it('lists every game, newest first, with a count', async () => {
    await open();

    expect(names()).toEqual(['Lobby', 'Race', 'Stuck', 'Won', 'Abandoned']);
    expect(screen.getByText('5 games')).toBeVisible();
  });

  it("says each game's state, board and owner", async () => {
    await open();

    expect(within(row('lobby')).getByText('Waiting')).toBeVisible();
    expect(within(row('race')).getByText('Live')).toBeVisible();
    expect(within(row('stuck')).getByText('Parked')).toBeVisible();
    expect(within(row('won')).getByText('Ended')).toBeVisible();
    expect(within(row('stuck')).getByText('ann').parentElement).toHaveTextContent('exchange · ann');
  });

  it('says who is here in a running game, and when it last moved', async () => {
    await open();

    expect(row('race')).toHaveTextContent('2 players · 1 online · last move 5 minutes ago');
    // Carl's account is gone, so he is not online.
    expect(row('stuck')).toHaveTextContent('1 player · 0 online');
    expect(row('lobby')).toHaveTextContent('1 player · created 1 minute ago');
  });

  it('says how a game that is over ended', async () => {
    await open();

    expect(row('won')).toHaveTextContent('won by bob · ended 10 minutes ago');
    expect(row('nobody')).toHaveTextContent('nobody won');
  });

  it('holds the list back until the publications land', async () => {
    setSubscriptionsLoading(true);
    try {
      await open();
      expect(screen.getByText('Loading...')).toBeVisible();
      expect(names()).toEqual([]);
    } finally {
      setSubscriptionsLoading(false);
    }
  });

  it('puts the picked game in the URL and marks its row', async () => {
    const router = await open();

    fireEvent.click(row('stuck'));

    expect(router.state.location.search).toBe('?game=stuck');
    expect(row('stuck')).toHaveAttribute('aria-pressed', 'true');
  });

  it('picks a row from the keyboard', async () => {
    const router = await open();

    fireEvent.keyDown(row('race'), { key: 'Enter' });

    expect(router.state.location.search).toBe('?game=race');
  });
});

describe('the filters', () => {
  it('counts each state on its button, All first and pressed', async () => {
    await open();
    const group = screen.getByRole('group', { name: 'Show games' });

    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['All5', 'Waiting1', 'Live1', 'Parked1', 'Ended2']);
    expect(within(group).getByRole('button', { name: /^All/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('shows one state at a time', async () => {
    await open();

    showing('Ended');
    expect(names()).toEqual(['Won', 'Abandoned']);
    expect(screen.getByText('2 of 5 games')).toBeVisible();

    showing('Parked');
    expect(names()).toEqual(['Stuck']);

    showing('All');
    expect(names()).toHaveLength(5);
  });

  it('filters by name, board, owner or player, ignoring case', async () => {
    await open();
    const filter = screen.getByRole('searchbox', { name: 'Filter games' });

    fireEvent.change(filter, { target: { value: 'EXCHANGE' } });
    expect(names()).toEqual(['Stuck']);

    fireEvent.change(filter, { target: { value: 'carl' } });
    expect(names()).toEqual(['Stuck']);

    fireEvent.change(filter, { target: { value: 'bob' } });
    expect(names()).toEqual(['Race']);
  });

  it('says so when nothing matches', async () => {
    await open();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter games' }), {
      target: { value: 'nothing like it' },
    });

    expect(screen.getByText('No games match.')).toBeVisible();
  });
});

describe('the game list, past ten games', () => {
  // With the five from the outer setup, all newer: 25 games, so three pages.
  beforeEach(async () => {
    for (let i = 1; i <= 20; i++) {
      await AdminGames.insertAsync(
        game({
          _id: `old${i}`,
          name: `Old ${i}`,
          winner: 'Nobody',
          submitted: Date.now() - (10 + i) * MINUTE,
        })
      );
    }
  });

  const pager = () => screen.getByRole('navigation', { name: 'Game pages' });

  it('shows ten at a time with the pager', async () => {
    await open();

    expect(names()).toHaveLength(10);
    expect(within(pager()).getByText('Page 1 of 3')).toBeVisible();
  });

  it('opens on the page that holds the game from the URL', async () => {
    await open('/admin/games?game=old18');

    expect(within(pager()).getByText('Page 3 of 3')).toBeVisible();
    expect(row('old18')).toHaveAttribute('aria-pressed', 'true');
  });

  it('goes back to the first page when the filter changes', async () => {
    await open();
    fireEvent.click(within(pager()).getByRole('button', { name: 'Next page' }));

    showing('Ended');

    expect(within(pager()).getByText('Page 1 of 3')).toBeVisible();
  });
});
