// @vitest-environment jsdom
// The lobby's seat list. The browser journey reads it as `ol li`, so the list stays an
// ordered list with one item per player.
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlayerList } from '../../client/views/game/PlayerList.tsx';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { renderAt, resetRouter, setRoute } from '../helpers/router.tsx';
import { setSubscriptionsLoading } from '../stubs/react-meteor-data.js';

beforeEach(async () => {
  resetFakeCollections();
  resetRouter();
  setSubscriptionsLoading(false);
  await loginAs('me');
});
afterEach(cleanup);

/** A routed game, as the fixture stores it. */
async function openLobby(overrides = {}) {
  // The fixture reads the document straight back, so there is always one.
  const game = (await insertGame({ started: false, ...overrides }))!;
  setRoute(`/games/${game._id}`);
  return game;
}

describe('PlayerList', () => {
  it('numbers every seat and names who is in it', async () => {
    const game = await openLobby();
    await insertPlayer(game._id, { userId: 'me', name: 'twonky' });
    await insertPlayer(game._id, { userId: 'them', name: 'spinbot' });

    renderAt(<PlayerList />);

    const seats = screen.getAllByRole('listitem');
    expect(seats).toHaveLength(2);
    expect(seats[0]).toHaveTextContent('1twonky');
    expect(seats[1]).toHaveTextContent('2spinbot');
  });

  it('says so when nobody has joined', async () => {
    await openLobby();

    renderAt(<PlayerList />);

    expect(screen.getByText('nobody joined yet :-(')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it.each([
    [1, 8, '1 to 8 players to start the game'],
    [5, 8, '5 to 8 players to start the game'],
    [8, 12, '8 to 12 players to start the game'],
  ])('states the seat range %i-%i', async (min_player, max_player, expected) => {
    await openLobby({ min_player, max_player });

    renderAt(<PlayerList />);

    expect(screen.getByText(expected)).toBeVisible();
  });

  it('says nothing at all until the subscriptions have landed', async () => {
    await openLobby();
    setSubscriptionsLoading(true);

    const { container } = renderAt(<PlayerList />);

    expect(container).toBeEmptyDOMElement();
  });
});
