// @vitest-environment jsdom
// The page around the routes: the navbar's links follow the login state, a visitor gets the
// landing card in place of the routed page, and the footer carries the presence pills and
// the tutorial link. The accounts menu is its own test.
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { AppLayout } from '../../client/views/layout/AppLayout.tsx';
import { loginAs, logout, resetFakeCollections } from '../setup.js';
import { renderAt, resetRouter, setRoute } from '../helpers/router.tsx';

beforeEach(() => {
  resetFakeCollections();
  resetRouter();
  Meteor.settings.public = {};
});
afterEach(cleanup);

/** The layout with a stand-in page under it, so the Outlet has something to show. */
function renderLayout(path = '/') {
  setRoute(path);
  return renderAt(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="*" element={<p>the routed page</p>} />
      </Route>
    </Routes>
  );
}

describe('AppLayout', () => {
  describe('for a visitor', () => {
    it('shows the landing card instead of the routed page, with no Games or Ranking links', () => {
      renderLayout('/ranking');

      expect(screen.getByRole('heading', { level: 2, name: 'roborally' })).toBeVisible();
      expect(screen.queryByText('the routed page')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Games' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Ranking' })).toBeNull();
      expect(document.getElementById('login-buttons')).toContainElement(
        document.getElementById('login-sign-in-link')
      );
    });

    it('falls back to "development" with no version configured, and shows no hash', () => {
      renderLayout();

      expect(screen.getByText('development')).toBeVisible();
      expect(document.querySelector('.font-mono')).toBeNull();
    });

    it('shows the configured version and the build hash', () => {
      Meteor.settings.public = { appVersion: '3.5.0-1' };
      Meteor.gitCommitHash = 'abc123';
      try {
        renderLayout();
      } finally {
        Meteor.gitCommitHash = undefined;
      }

      expect(screen.getByText('3.5.0-1')).toBeVisible();
      expect(screen.getByText('abc123')).toHaveClass('font-mono');
    });

    it('links to the source and the change log', () => {
      renderLayout();

      expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
        'href',
        'https://github.com/ben-morin/roborally'
      );
      expect(screen.getByRole('link', { name: 'Change log' })).toHaveAttribute('target', '_blank');
    });
  });

  describe('signed in', () => {
    beforeEach(() => loginAs('me'));

    it('renders the routed page with the Games and Ranking links, marking the current one', () => {
      renderLayout('/ranking');

      expect(screen.getByText('the routed page')).toBeVisible();
      expect(screen.queryByRole('heading', { name: 'roborally' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Games' })).toHaveAttribute('href', '/');
      expect(screen.getByRole('link', { name: 'Ranking' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Games' })).not.toHaveAttribute('aria-current');
    });

    it('marks Games current on the game list, and nothing on a lobby', () => {
      renderLayout('/');
      expect(screen.getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page');
      cleanup();

      renderLayout('/games/g1');
      expect(screen.getByRole('link', { name: 'Games' })).not.toHaveAttribute('aria-current');
      expect(screen.getByRole('link', { name: 'Ranking' })).not.toHaveAttribute('aria-current');
    });

    it('goes back to the landing card on logout', () => {
      const { rerender } = renderLayout();
      expect(screen.getByText('the routed page')).toBeVisible();

      logout();
      rerender(
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="*" element={<p>the routed page</p>} />
          </Route>
        </Routes>
      );

      expect(screen.getByRole('heading', { level: 2, name: 'roborally' })).toBeVisible();
    });
  });

  it('carries the presence pills and the tutorial link in the footer', async () => {
    await loginAs('me');
    await Meteor.users.insertAsync({
      _id: 'ann',
      profile: { name: 'ann' },
      status: { online: true, idle: false },
    });
    renderLayout();

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('ann')).toHaveClass('users-pill');
    expect(within(footer).getByRole('link', { name: 'tutorial video' })).toHaveAttribute(
      'href',
      'https://youtu.be/0l8Y-L5IZLE'
    );
    expect(footer.querySelector('.tutorial a')).not.toBeNull();
  });

  it('renders the one dialog element, shut', () => {
    renderLayout();

    expect(document.querySelectorAll('dialog')).toHaveLength(1);
    expect(document.querySelector('dialog')!.open).toBe(false);
  });
});
