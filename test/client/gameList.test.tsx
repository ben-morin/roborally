// @vitest-environment jsdom
// The lobby index. One collection split three ways, so what the rows say about a game and
// which list it lands in is the whole of it.
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameList } from '../../client/views/game/GameList.tsx';
import { insertGame } from '../helpers/fixtures.js';
import { resetFakeCollections } from '../setup.js';
import { renderAt } from '../helpers/router.tsx';

beforeEach(() => resetFakeCollections());
afterEach(cleanup);

/** The row titles under one heading, in the order they are rendered. */
function rows(heading: string) {
  const list = screen
    .getByRole('heading', { name: heading })
    .parentElement?.querySelector<HTMLElement>('ul');
  if (!list) return [];
  // The whole row is the link; its first span is the title, the second the meta text.
  return within(list)
    .getAllByRole('link')
    .map((row) => row.firstElementChild?.textContent);
}

describe('GameList', () => {
  it('splits games into open, active and ended, newest first', async () => {
    await insertGame({ name: 'open old', started: false, submitted: 1 });
    await insertGame({ name: 'open new', started: false, submitted: 2 });
    await insertGame({ name: 'running', started: true, submitted: 3 });
    await insertGame({ name: 'done first', started: true, winner: 'ann', stopped: 10 });
    await insertGame({ name: 'done last', started: true, winner: 'bob', stopped: 20 });

    renderAt(<GameList />);

    // `{winner: null}` is Mongo's "null or missing", so a game in progress counts as open.
    expect(rows('Open games')).toEqual(['open new', 'open old']);
    expect(rows('Active games')).toEqual(['running']);
    expect(rows('Finished games')).toEqual(['done last', 'done first']);
  });

  it('keeps a finished game out of the open and active lists', async () => {
    await insertGame({ name: 'done', started: true, winner: 'Nobody', stopped: 1 });

    renderAt(<GameList />);

    expect(rows('Open games')).toEqual([]);
    expect(rows('Active games')).toEqual([]);
    expect(rows('Finished games')).toEqual(['done']);
  });

  it('dates an open game and names the winner of a finished one', async () => {
    await insertGame({ name: 'open', started: false, submitted: Date.now() - 5 * 60_000 });
    await insertGame({
      name: 'done',
      started: true,
      winner: 'ann',
      stopped: Date.now() - 3 * 3_600_000,
    });

    renderAt(<GameList />);

    expect(screen.getByText('created 5 minutes ago')).toBeVisible();
    expect(screen.getByText('won by ann 3 hours ago')).toBeVisible();
  });

  it('links every row to the game’s own page', async () => {
    // The fixture reads the document straight back, so there is always one.
    const game = (await insertGame({ name: 'open', started: false, submitted: 1 }))!;

    renderAt(<GameList />);

    // The row's accessible name is the title with the meta text run on after it.
    expect(screen.getByRole('link', { name: /^open/ })).toHaveAttribute(
      'href',
      `/games/${game._id}`
    );
  });

  it('says so under each heading when there is nothing to list', () => {
    renderAt(<GameList />);

    expect(screen.getByText('No open games at the moment, create one at the right.')).toBeVisible();
    expect(screen.getByText('No active games at the moment')).toBeVisible();
  });
});
