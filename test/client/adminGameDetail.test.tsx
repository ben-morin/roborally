// @vitest-environment jsdom
// The games manager's detail panel, on the real `/admin/games` route with an admin signed
// in: the facts for each state, who sits in the game and whether they are here, the last
// chat lines, which is where a parked game says why, and the End and Delete buttons. Each
// button runs the real admin method in the server harness, so a test reads what the server
// wrote; only the dialogs are replaced.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.ts', async (importOriginal) => ({
  // The layout's <Modal> still needs the queue's own exports.
  ...(await importOriginal<typeof import('../../client/helper/modalDialogs.ts')>()),
  modalAlert: vi.fn(async () => true),
  modalConfirm: vi.fn(async () => true),
}));

import { createMemoryRouter, RouterProvider } from 'react-router';
import { GameState } from '../../both/gamestate.ts';
import { modalAlert, modalConfirm } from '../../client/helper/modalDialogs.ts';
import { AdminGames, AdminPlayers } from '../../client/views/admin/AdminGames.ts';
import { AdminUsers } from '../../client/views/admin/AdminUsers.ts';
import { routes } from '../../client/views/router.tsx';
import type { AdminGameDoc } from '../../client/lib/adminGames.ts';
import { Chat } from '../../collections/chat.ts';
import { Games } from '../../collections/games.ts';
import { insertGame } from '../helpers/fixtures.js';
import { loginAs, logout, resetFakeCollections, setSettings } from '../setup.js';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

const MINUTE = 60_000;
const ADMIN = {
  _id: 'admin',
  profile: { name: 'admin' },
  emails: [{ address: 'admin@example.com', verified: true }],
};

function game(fields: Partial<AdminGameDoc> = {}): AdminGameDoc {
  return {
    _id: 'g',
    name: 'Friday Race',
    userId: 'ann',
    author: 'ann',
    submitted: Date.now() - 60 * MINUTE,
    started: true,
    gamePhase: 'play',
    playPhase: 'lasers',
    programRound: 4,
    boardName: 'checkmate',
    min_player: 1,
    max_player: 8,
    lastStepAt: new Date(Date.now() - 5 * MINUTE),
    ...fields,
  };
}

beforeEach(async () => {
  resetFakeCollections();
  setSubscriptionsLoading(false);
  setSettings({ ADMIN_EMAILS: ['admin@example.com'] });
  logout();
  await loginAs(ADMIN);
  await AdminUsers.insertAsync(ADMIN);
  await AdminUsers.insertAsync({ _id: 'ann', profile: { name: 'ann' }, status: { online: true } });
  await AdminUsers.insertAsync({
    _id: 'bob',
    profile: { name: 'bob' },
    status: { online: true, idle: true },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setSettings();
});

async function openOn(doc: AdminGameDoc) {
  await AdminGames.insertAsync(doc);
  const router = createMemoryRouter(routes, { initialEntries: [`/admin/games?game=${doc._id}`] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: /Friday Race/ });
  return router;
}

// The facts as the panel lists them, term → value.
function facts() {
  const terms = Array.from(document.querySelectorAll('dl dt')).map((dt) => dt.textContent);
  const values = Array.from(document.querySelectorAll('dl dd')).map((dd) => dd.textContent);
  return Object.fromEntries(terms.map((term, i) => [term, values[i]]));
}

describe('the game panel', () => {
  it('asks for a pick when nothing is selected', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/admin/games'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Pick a game')).toBeVisible();
  });

  it('shows a running game: board, owner, turn, phase and last move', async () => {
    await openOn(game());

    expect(facts()).toEqual({
      State: 'Live',
      Board: 'checkmate',
      Owner: 'ann',
      Created: '1 hour ago',
      Turn: '4 · play, lasers',
      'Last move': '5 minutes ago',
    });
  });

  it('shows a parked game and its failed replays', async () => {
    await openOn(game({ gamePhase: 'program', resumeAttempts: 3 }));

    expect(facts()).toMatchObject({
      State: 'Parked',
      Turn: '4 · program',
      'Failed replays': '3 of 3',
    });
  });

  it('shows a lobby without a turn', async () => {
    await openOn(game({ started: false, gamePhase: 'waiting', lastStepAt: null }));

    expect(facts()).toEqual({
      State: 'Waiting',
      Board: 'checkmate',
      Owner: 'ann',
      Created: '1 hour ago',
    });
  });

  it('shows how a game that is over ended', async () => {
    await openOn(
      game({ gamePhase: 'game ended', winner: 'bob', stopped: Date.now() - 10 * MINUTE })
    );

    expect(facts()).toMatchObject({
      State: 'Ended',
      Result: 'won by bob',
      Ended: '10 minutes ago',
    });
    expect(facts()).not.toHaveProperty('Turn');
  });

  it('lists the players with their presence, and says when an account is gone', async () => {
    await AdminPlayers.insertAsync({ _id: 'p1', gameId: 'g', userId: 'ann', name: 'ann' });
    await AdminPlayers.insertAsync({ _id: 'p2', gameId: 'g', userId: 'bob', name: 'bob' });
    await AdminPlayers.insertAsync({ _id: 'p3', gameId: 'g', userId: 'gone', name: 'Carl' });
    await AdminPlayers.insertAsync({ _id: 'p4', gameId: 'other', userId: 'ann', name: 'ann' });
    await openOn(game());

    const items = within(screen.getByText('Players').parentElement!).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'annonline',
      'bobidle',
      'Carlno account',
    ]);
  });

  it('says when nobody is seated', async () => {
    await openOn(game());

    expect(screen.getByText('Nobody is seated.')).toBeVisible();
  });

  it("shows the game's last five chat lines, oldest first", async () => {
    for (let i = 1; i <= 7; i++) {
      await Chat.insertAsync({
        gameId: 'g',
        message: `line ${i}`,
        submitted: Date.now() - (10 - i) * MINUTE,
        ...(i === 7 ? { author: 'ann', userId: 'ann' } : {}),
      });
    }
    await Chat.insertAsync({ gameId: 'other', message: 'elsewhere', submitted: Date.now() });
    await openOn(game());

    // The box after the heading; each row's parts read in order, a space between each.
    const rows = [...screen.getByText('Last chat').nextElementSibling!.children];
    const parts = (row: Element) => [...row.children].map((part) => part.textContent).join(' ');
    expect(rows.map(parts)).toEqual([
      '· line 3 7m',
      '· line 4 6m',
      '· line 5 5m',
      '· line 6 4m',
      'ann line 7 3m',
    ]);
    // The admin is not in the game, so no name is the viewer's own.
    expect(screen.getByText('ann', { selector: '.font-semibold' })).not.toHaveClass('text-teal');
  });

  it('says when the game has no chat', async () => {
    await openOn(game());

    expect(screen.getByText('No chat yet.')).toBeVisible();
  });
});

describe('the actions', () => {
  const button = (name: string) => screen.queryByRole('button', { name });
  const stored = () => Games.findOneAsync('g');
  // The server reads `Games`; the page reads the publication's own collection. Both get the
  // same game, as the real publication would make it.
  async function both(fields: Partial<AdminGameDoc> = {}) {
    const doc = game(fields);
    const { lastStepAt, ...rest } = doc;
    await insertGame({ ...rest, lastStepAt: lastStepAt ?? null });
    return openOn(doc);
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('offers End on a live game, with a note, and no Delete', async () => {
    await both();

    expect(button('End game')).toBeVisible();
    expect(screen.getByText('End the game before you delete it.')).toBeVisible();
    expect(button('Delete game')).toBeNull();
  });

  it('offers End on a parked game', async () => {
    await both({ resumeAttempts: 3 });

    expect(button('End game')).toBeVisible();
  });

  it('offers Delete on a lobby and on a game that is over, and no End', async () => {
    await both({ started: false, gamePhase: GameState.PHASE.IDLE });
    expect(button('Delete game')).toBeVisible();
    expect(button('End game')).toBeNull();
    cleanup();

    await AdminGames.removeAsync('g');
    await Games.removeAsync('g');
    await both({ gamePhase: GameState.PHASE.ENDED, winner: 'Nobody' });
    expect(button('Delete game')).toBeVisible();
    expect(button('End game')).toBeNull();
  });

  it('ends the game after the confirm, with nothing more to dismiss', async () => {
    await both();

    fireEvent.click(button('End game')!);

    await vi.waitFor(async () => expect((await stored())!.gamePhase).toBe(GameState.PHASE.ENDED));
    expect(modalConfirm).toHaveBeenCalledWith(
      'End "Friday Race"? Nobody wins, and the players see the game end.'
    );
    expect((await stored())!.winner).toBe('Nobody');
    await tick();
    expect(modalAlert).not.toHaveBeenCalled();
  });

  it('sends nothing when the confirm is cancelled', async () => {
    vi.mocked(modalConfirm).mockResolvedValueOnce(false);
    await both();

    fireEvent.click(button('End game')!);

    await vi.waitFor(() => expect(modalConfirm).toHaveBeenCalled());
    await tick();
    expect((await stored())!.gamePhase).toBe('play');
  });

  it('deletes a game that is over and clears the selection', async () => {
    const router = await both({ gamePhase: GameState.PHASE.ENDED, winner: 'bob' });

    fireEvent.click(button('Delete game')!);

    await vi.waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await stored()).toBeUndefined();
    expect(modalConfirm).toHaveBeenCalledWith(
      `Delete "Friday Race"? Its players' games played and its win leave the rankings. This cannot be undone.`
    );
    expect(modalAlert).not.toHaveBeenCalled();
  });

  it('says only the games played go when nobody won', async () => {
    await both({ gamePhase: GameState.PHASE.ENDED, winner: 'Nobody' });

    fireEvent.click(button('Delete game')!);

    await vi.waitFor(() =>
      expect(modalConfirm).toHaveBeenCalledWith(
        `Delete "Friday Race"? Its players' games played leave the rankings. This cannot be undone.`
      )
    );
  });

  it('warns that a lobby loses its players', async () => {
    await both({ started: false, gamePhase: GameState.PHASE.IDLE });

    fireEvent.click(button('Delete game')!);

    await vi.waitFor(async () => expect(await stored()).toBeUndefined());
    expect(modalConfirm).toHaveBeenCalledWith(
      'Delete "Friday Race"? The players in its lobby lose their seats. This cannot be undone.'
    );
  });

  it('renames the game from the name field, with nothing to dismiss', async () => {
    await both();
    const field = screen.getByLabelText('Name');
    expect(field).toHaveValue('Friday Race');
    expect(field).toHaveAttribute('maxLength', '40');

    fireEvent.change(field, { target: { value: 'Sunday Race' } });
    fireEvent.click(button('Rename')!);

    await vi.waitFor(async () => expect((await stored())!.name).toBe('Sunday Race'));
    await tick();
    expect(modalConfirm).not.toHaveBeenCalled();
    expect(modalAlert).not.toHaveBeenCalled();
  });

  it('shows a refused name as the server worded it', async () => {
    await both();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' ' } });
    fireEvent.click(button('Rename')!);

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Name cannot be empty.'));
    expect((await stored())!.name).toBe('Friday Race');
  });

  it('shows a refusal as the server worded it', async () => {
    // The screen still shows it running; the server already has it over.
    await AdminGames.insertAsync(game());
    await insertGame({ ...game(), lastStepAt: null, winner: 'ann', gamePhase: 'game ended' });
    const router = createMemoryRouter(routes, { initialEntries: ['/admin/games?game=g'] });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: /Friday Race/ });

    fireEvent.click(button('End game')!);

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('This game is already over.'));
  });
});
