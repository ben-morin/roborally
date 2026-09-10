// @vitest-environment jsdom
// The route table and the five pages: which components each page puts in which column,
// the two started-game redirects, the loading state and the unknown-id bounce that the
// FlowRouter actions used to own. Mounted through the real route table in a memory router,
// so a test drives a URL and reads the page that comes out.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../../client/views/router.tsx';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { loginAs, logout, resetFakeCollections } from '../setup.js';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

beforeEach(async () => {
  resetFakeCollections();
  setSubscriptionsLoading(false);
  // The chat scrolls its message list on mount; jsdom has no scrollTo.
  Element.prototype.scrollTo = () => {};
  await loginAs('me');
});
afterEach(cleanup);

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const headings = () => screen.getAllByRole('heading').map((h) => h.textContent);
const rightPanel = () => document.querySelector('.right-panel')!;
const panels = () => document.querySelectorAll('.panel');

describe('the pages', () => {
  it('/ is the game lists, with the create form and the chat on the right', () => {
    open('/');

    expect(headings()).toEqual(
      expect.arrayContaining([
        'Open games',
        'Active games',
        'Finished games',
        'Create game',
        'Chat',
      ])
    );
    expect(rightPanel()).toContainElement(screen.getByRole('heading', { name: 'Create game' }));
    expect(rightPanel()).toContainElement(screen.getByRole('heading', { name: 'Chat' }));
    expect(panels()).toHaveLength(3);
  });

  it('/ranking is the two highscore lists, with the chat on the right', () => {
    open('/ranking');

    expect(screen.getByRole('heading', { name: 'Most games played' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Most games won' })).toBeVisible();
    expect(rightPanel()).toContainElement(screen.getByRole('heading', { name: 'Chat' }));
    expect(panels()).toHaveLength(2);
  });

  describe('/games/:id', () => {
    it('is the lobby: chat on the left; actions, players and the board on the right', async () => {
      const game = (await insertGame({ started: false, userId: 'them', author: 'them' }))!;
      await insertPlayer(game._id, { userId: 'them', name: 'them' });

      open(`/games/${game._id}`);

      expect(screen.getByRole('heading', { name: 'Chat' })).toBeVisible();
      for (const name of ['Players', 'Board']) {
        expect(rightPanel()).toContainElement(screen.getByRole('heading', { name }));
      }
      expect(rightPanel()).toContainElement(screen.getByRole('heading', { level: 2 }));
      expect(panels()).toHaveLength(4);
    });

    it('redirects to the board, replacing the entry, once the game has started', async () => {
      const game = (await insertGame({ started: true }))!;

      const router = open(`/games/${game._id}`);

      expect(router.state.location.pathname).toBe(`/board/${game._id}`);
      // One history entry, so the back button does not bounce forward again.
      expect(router.state.historyAction).toBe('REPLACE');
    });
  });

  describe('/select/:id', () => {
    it('is board select on the left with the lobby actions and players on the right', async () => {
      const game = (await insertGame({ started: false }))!;

      open(`/select/${game._id}`);

      expect(screen.getByRole('heading', { name: 'Select board' })).toBeVisible();
      expect(screen.getByRole('tablist')).toBeVisible();
      expect(rightPanel()).toContainElement(screen.getByRole('heading', { name: 'Players' }));
      expect(panels()).toHaveLength(3);
    });

    it('holds the page on Loading while the subscriptions are in flight', async () => {
      const game = (await insertGame({ started: false }))!;
      setSubscriptionsLoading(true);

      open(`/select/${game._id}`);

      expect(screen.getByText('Loading...')).toBeVisible();
      expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('sends an unknown game home, replacing the entry', () => {
      const router = open('/select/no-such-game');

      expect(router.state.location.pathname).toBe('/');
      expect(router.state.historyAction).toBe('REPLACE');
    });

    it('redirects to the board once the game has started', async () => {
      const game = (await insertGame({ started: true }))!;

      const router = open(`/select/${game._id}`);

      expect(router.state.location.pathname).toBe(`/board/${game._id}`);
    });
  });

  it('/board/:id is the board on the left, the card panel and chat on the right', async () => {
    const game = (await insertGame({ started: true }))!;
    await insertPlayer(game._id, { userId: 'me', name: 'me', robotId: '0', start: { x: 1, y: 2 } });

    open(`/board/${game._id}`);

    expect(document.getElementById('board')).not.toBeNull();
    expect(document.querySelector('.panel-tight')).toContainElement(
      document.getElementById('board')
    );
    expect(rightPanel()).toContainElement(screen.getByRole('heading', { name: 'Pick your cards' }));
    expect(rightPanel()).toContainElement(screen.getByRole('heading', { name: 'Chat' }));
    expect(panels()).toHaveLength(3);
  });

  it('shows the landing card on every route for a visitor', async () => {
    const game = (await insertGame({ started: true }))!;
    logout();

    open(`/board/${game._id}`);

    expect(screen.getByRole('heading', { level: 2, name: 'roborally' })).toBeVisible();
    expect(document.getElementById('board')).toBeNull();
  });
});
