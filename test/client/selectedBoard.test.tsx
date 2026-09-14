// @vitest-environment jsdom
// The lobby's board panel. It wraps the Thumbnail component and owns the one link into
// board select, which the browser journey clicks as `a.select`.
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SelectedBoard } from '../../client/views/game/SelectedBoard.tsx';
import { insertGame } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { navigations_, renderAt, resetRouter, setRoute } from '../helpers/router.tsx';

beforeEach(async () => {
  resetFakeCollections();
  resetRouter();
  await loginAs('me');
});
afterEach(cleanup);

async function openLobby(overrides = {}) {
  // The fixture reads the document straight back, so there is always one.
  const game = (await insertGame({
    started: false,
    boardName: 'default',
    userId: 'me',
    ...overrides,
  }))!;
  setRoute(`/games/${game._id}`);
  return game;
}

describe('SelectedBoard', () => {
  it('draws the pit placeholder for a board name it cannot build', async () => {
    await openLobby({ boardName: 'gone_board' });

    const { container } = renderAt(<SelectedBoard />);

    const preview = container.querySelector('.selected-board .board-thumbnail');
    expect(preview).toHaveAttribute('id', 'gone_board');
    expect(preview).toHaveStyle({ width: '240px', height: '320px' });
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Board not available');
    expect(container.querySelector('.selected-board .players')).toHaveTextContent(
      'Not in the catalog'
    );
    expect(container.querySelector('.selected-board .length')).toBeNull();
  });

  it('draws the game’s board at preview size', async () => {
    const game = await openLobby();
    const board = game.board();

    const { container } = renderAt(<SelectedBoard />);

    const preview = container.querySelector('.selected-board .board-thumbnail');
    expect(preview).toHaveAttribute('id', board.name);
    expect(preview).toHaveStyle({
      width: `${board.width * 20}px`,
      height: `${board.height * 20}px`,
    });
  });

  it('lets only the owner change the board', async () => {
    await openLobby({ userId: 'them' });
    const { rerender } = renderAt(<SelectedBoard />);
    expect(screen.queryByRole('link', { name: 'Change board' })).not.toBeInTheDocument();

    await openLobby({ userId: 'me' });
    rerender(<SelectedBoard />);
    expect(screen.getByRole('link', { name: 'Change board' })).toHaveClass('select');
  });

  it('routes to board select', async () => {
    const game = await openLobby();

    renderAt(<SelectedBoard />);
    await userEvent.click(screen.getByRole('link', { name: 'Change board' }));

    expect(navigations_()).toEqual([`/select/${game._id}`]);
  });

  it('draws no board at all with no game routed', () => {
    const { container } = renderAt(<SelectedBoard />);

    expect(screen.getByRole('heading', { name: 'Board' })).toBeVisible();
    expect(container.querySelector('.board-thumbnail')).toBeNull();
  });
});
