// @vitest-environment jsdom
// The lobby's action panel, and with it the two redirects off the page — the piece the
// Blaze template drove from an `onCreated` autorun with a `gameLoaded` latch. modalDialogs
// is mocked so the handlers' own decisions are what gets asserted.
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.ts', () => ({
  modalAlert: vi.fn(),
  modalConfirm: vi.fn(async () => true),
}));

import { GameActions } from '../../client/views/game/GameActions.tsx';
import { modalAlert, modalConfirm } from '../../client/helper/modalDialogs.ts';
import { Games } from '../../collections/games.ts';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { navigations_, renderAt, resetRouter, setRoute } from '../helpers/router.tsx';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

beforeEach(async () => {
  resetFakeCollections();
  resetRouter();
  setSubscriptionsLoading(false);
  await loginAs('me');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // A `Meteor.callAsync` spy left standing would answer the next test's method calls —
  // harmless while the handlers were never reached, load-bearing now that one test asserts
  // a method was called and another asserts it was not.
  vi.restoreAllMocks();
});

/** A lobby the caller is looking at, routed the way FlowRouter would have it. */
async function openLobby({ ownerId = 'me', seated = false, started = false } = {}) {
  // The fixture reads the document straight back, so there is always one.
  const game = (await insertGame({ userId: ownerId, author: ownerId, started, min_player: 2 }))!;
  if (seated) await insertPlayer(game._id, { userId: 'me', name: 'me' });
  setRoute(`/games/${game._id}`);
  return game;
}

describe('GameActions', () => {
  it('names the author under an eyebrow, in one heading', async () => {
    await openLobby({ ownerId: 'them' });

    renderAt(<GameActions />);

    // The browser journey matches an h2 carrying both halves.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Game created by');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('them');
  });

  it('offers a seat to a stranger and not to somebody already seated', async () => {
    const game = await openLobby({ ownerId: 'them' });
    const { rerender } = renderAt(<GameActions />);
    expect(screen.getByRole('link', { name: 'Join game' })).toBeVisible();

    await insertPlayer(game._id, { userId: 'me', name: 'me' });
    rerender(<GameActions />);

    expect(screen.queryByRole('link', { name: 'Join game' })).not.toBeInTheDocument();
  });

  it('closes the game to newcomers at eight players', async () => {
    const game = await openLobby({ ownerId: 'them' });
    for (let i = 0; i < 8; i++) await insertPlayer(game._id, { userId: `p${i}` });

    renderAt(<GameActions />);

    expect(screen.queryByRole('link', { name: 'Join game' })).not.toBeInTheDocument();
  });

  it('lets only the owner start, and only with somebody seated', async () => {
    await openLobby({ ownerId: 'me' });
    const { rerender } = renderAt(<GameActions />);
    expect(screen.queryByRole('link', { name: 'Start game' })).not.toBeInTheDocument();

    const game = await openLobby({ ownerId: 'me', seated: true });
    rerender(<GameActions />);
    expect(screen.getByRole('link', { name: 'Start game' })).toHaveClass('start');

    await Games.updateAsync(game._id, { $set: { userId: 'them' } });
    rerender(<GameActions />);
    expect(screen.queryByRole('link', { name: 'Start game' })).not.toBeInTheDocument();
  });

  it.each([
    ['Join game', 'joinGame'],
    ['Leave game', 'leaveGame'],
    ['Start game', 'startGame'],
  ])('sends %s to the server', async (label, method) => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    // Join is offered to somebody with no seat, Leave and Start to the seated owner.
    const joining = label === 'Join game';
    const game = await openLobby({ ownerId: joining ? 'them' : 'me', seated: !joining });

    renderAt(<GameActions />);
    await userEvent.click(screen.getByRole('link', { name: label }));

    expect(call).toHaveBeenCalledWith(method, { gameId: game._id });
  });

  it('surfaces a rejected start to the player', async () => {
    vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'Too many players.' });
    await openLobby({ ownerId: 'me', seated: true });

    renderAt(<GameActions />);
    await userEvent.click(screen.getByRole('link', { name: 'Start game' }));

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Too many players.'));
  });

  it('sends the cancel to the server after confirmation and returns to the list', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const game = await openLobby({ ownerId: 'me' });

    renderAt(<GameActions />);
    await userEvent.click(screen.getByRole('link', { name: 'Cancel game' }));

    expect(modalConfirm).toHaveBeenCalledWith('Remove this game?');
    await vi.waitFor(() => expect(navigations_()).toEqual(['/']));
    // A method now, not the client-side `Games.remove` the app's last allow rule permitted;
    // what it takes with it is pinned in test/server/methods.test.js.
    expect(call).toHaveBeenCalledWith('cancelGame', { gameId: game._id });
    // The owner asked for this, so the effect's "cancelled under you" alert must not fire.
    expect(modalAlert).not.toHaveBeenCalled();
  });

  it('keeps the game when the confirmation is declined', async () => {
    vi.mocked(modalConfirm).mockResolvedValueOnce(false);
    const game = await openLobby({ ownerId: 'me' });

    renderAt(<GameActions />);
    await userEvent.click(screen.getByRole('link', { name: 'Cancel game' }));

    await vi.waitFor(() => expect(modalConfirm).toHaveBeenCalled());
    expect(await Games.findOneAsync(game._id)).toBeDefined();
    expect(navigations_()).toEqual([]);
  });

  it('returns to the list with a notice when the game is cancelled under the reader', async () => {
    const game = await openLobby({ ownerId: 'them' });
    const { rerender } = renderAt(<GameActions />);
    expect(navigations_()).toEqual([]);

    await Games.removeAsync(game._id);
    rerender(<GameActions />);

    await vi.waitFor(() => expect(navigations_()).toEqual(['/']));
    expect(modalAlert).toHaveBeenCalledWith('The game was canceled.');
  });

  it('waits for the subscription before deciding a game is gone', async () => {
    setSubscriptionsLoading(true);
    setRoute('/games/not-here-yet');

    renderAt(<GameActions />);

    expect(navigations_()).toEqual([]);
    expect(modalAlert).not.toHaveBeenCalled();
  });

  it('returns to the list without a notice when the id names no game', async () => {
    setRoute('/games/never-existed');

    renderAt(<GameActions />);

    await vi.waitFor(() => expect(navigations_()).toEqual(['/']));
    expect(modalAlert).not.toHaveBeenCalled();
  });
});
