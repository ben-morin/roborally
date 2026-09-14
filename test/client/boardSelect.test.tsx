// @vitest-environment jsdom
// The board catalog: one tab per visible group of BoardBox.GROUPS, and one choice per
// board. modalDialogs is mocked so the handler's own decisions are what gets asserted;
// the dialogs themselves are tested for real in modalDialogs.test.js.
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.ts', () => ({
  modalAlert: vi.fn(),
  modalConfirm: vi.fn(async () => true),
}));

import { BoardBox } from '../../both/board_box.ts';
import { BoardSelect } from '../../client/views/game/BoardSelect.tsx';
import { modalAlert } from '../../client/helper/modalDialogs.ts';
import { insertGame } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { navigations_, renderAt, resetRouter, setRoute } from '../helpers/router.tsx';

const TABS = BoardBox.visibleGroups();
const count = (id: string) => TABS.find((group) => group.id === id)!.boards.length;
const EXPERT_CNT = count('expert');
const CUSTOM_CNT = count('custom');

beforeEach(async () => {
  resetFakeCollections();
  resetRouter();
  await loginAs('me');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openSelect(boardName: string) {
  // The fixture reads the document straight back, so there is always one.
  const game = (await insertGame({ started: false, boardName, userId: 'me' }))!;
  setRoute(`/select/${game._id}`);
  return game;
}

const tab = (name: string) => screen.getByRole('tab', { name });
const choices = () =>
  screen.queryAllByRole('button').filter((el) => el.classList.contains('boardchoice'));

describe('BoardSelect', () => {
  it.each(TABS.map((group) => [group.label, group.boards[0], group.boards.length]))(
    'opens on %s for the board the game is set to',
    async (label, boardName, count) => {
      await openSelect(boardName);

      renderAt(<BoardSelect />);

      expect(tab(label)).toHaveAttribute('aria-selected', 'true');
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
      expect(choices()).toHaveLength(count);
    }
  );

  it('renders one tab per visible group, the dev one included in development', async () => {
    await openSelect('default');

    renderAt(<BoardSelect />);

    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(
      TABS.map((group) => group.label)
    );
    expect(tab('Dev boards')).toBeVisible();
  });

  it('renders no dev tab outside development', async () => {
    await openSelect('default');
    Meteor.isDevelopment = false;
    try {
      renderAt(<BoardSelect />);
    } finally {
      Meteor.isDevelopment = true;
    }

    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(
      TABS.filter((group) => !group.devOnly).map((group) => group.label)
    );
    expect(screen.queryByRole('tab', { name: 'Dev boards' })).toBeNull();
  });

  it('opens the first tab for a game on a dev board outside development', async () => {
    await openSelect('dev_test');
    Meteor.isDevelopment = false;
    try {
      renderAt(<BoardSelect />);
    } finally {
      Meteor.isDevelopment = true;
    }

    expect(tab('Beginner courses')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryAllByRole('button', { current: true })).toHaveLength(0);
  });

  it('opens its group’s tab for a game on a hidden board, marking nothing', async () => {
    await openSelect('moving_targets');

    renderAt(<BoardSelect />);

    expect(tab('Expert courses')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryAllByRole('button', { current: true })).toHaveLength(0);
  });

  it('marks the game’s own board and no other', async () => {
    await openSelect('checkmate');

    renderAt(<BoardSelect />);

    const current = screen.getAllByRole('button', { current: true });
    expect(current).toHaveLength(1);
    expect(within(current[0]).getByText(BoardBox.getBoard('checkmate').title)).toBeVisible();
  });

  it('switches category on a tab click', async () => {
    await openSelect('default');
    renderAt(<BoardSelect />);

    await userEvent.click(tab('Custom courses'));

    expect(tab('Custom courses')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Beginner courses')).toHaveAttribute('aria-selected', 'false');
    expect(choices()).toHaveLength(CUSTOM_CNT);
  });

  it('moves between tabs with the arrow keys, wrapping at both ends', async () => {
    await openSelect('default');
    renderAt(<BoardSelect />);
    tab('Beginner courses').focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Expert courses')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Expert courses')).toHaveFocus();
    expect(choices()).toHaveLength(EXPERT_CNT);

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tab('Dev boards')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Dev boards')).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Beginner courses')).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps one tab stop: only the open tab is reachable by Tab', async () => {
    await openSelect('default');
    renderAt(<BoardSelect />);

    expect(tab('Beginner courses')).toHaveAttribute('tabindex', '0');
    expect(tab('Expert courses')).toHaveAttribute('tabindex', '-1');
    expect(tab('Custom courses')).toHaveAttribute('tabindex', '-1');
  });

  it('sends the clicked board to the server and returns to the game page', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const game = await openSelect('default');
    renderAt(<BoardSelect />);

    await userEvent.click(choices()[2]);

    expect(call).toHaveBeenCalledWith('selectBoard', {
      boardName: 'checkmate',
      gameId: game._id,
    });
    await vi.waitFor(() => expect(navigations_()).toEqual([`/games/${game._id}`]));
  });

  it('selects a board from the keyboard too', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await openSelect('default');
    renderAt(<BoardSelect />);

    choices()[1].focus();
    await userEvent.keyboard('{Enter}');

    expect(call).toHaveBeenCalledWith(
      'selectBoard',
      expect.objectContaining({ boardName: 'risky_exchange' })
    );
  });

  it('reports a refusal through the modal and stays put', async () => {
    vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'Board not found!' });
    await openSelect('default');
    renderAt(<BoardSelect />);

    await userEvent.click(choices()[0]);

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Board not found!'));
    expect(navigations_()).toEqual([]);
  });

  it('offers the tabs but no choices with no game routed', () => {
    renderAt(<BoardSelect />);

    expect(screen.getAllByRole('tab')).toHaveLength(TABS.length);
    expect(tab('Beginner courses')).toHaveAttribute('aria-selected', 'true');
    expect(choices()).toHaveLength(0);
  });
});
