// @vitest-environment jsdom
// The create-game panel. modalDialogs is mocked so what the handler decides is what gets
// asserted; the dialog itself is tested for real in modalDialogs.test.js.
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.ts', () => ({
  modalAlert: vi.fn(),
  modalConfirm: vi.fn(async () => true),
}));

import { CreateGameForm } from '../../client/views/game/CreateGameForm.tsx';
import { modalAlert } from '../../client/helper/modalDialogs.ts';
import { insertGame } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { navigations_, renderAt, resetRouter } from '../helpers/router.tsx';

beforeEach(async () => {
  resetFakeCollections();
  resetRouter();
  await loginAs('me');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CreateGameForm', () => {
  it('creates a game from the form and routes to its page', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue('new-id');

    renderAt(<CreateGameForm />);
    await userEvent.type(screen.getByPlaceholderText('The name of your game'), 'my game');
    await userEvent.click(screen.getByRole('button', { name: 'Create game' }));

    expect(call).toHaveBeenCalledWith('createGame', { name: 'my game' });
    await vi.waitFor(() => expect(navigations_()).toEqual(['/games/new-id']));
  });

  it('reports a rejected creation instead of navigating', async () => {
    vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'Name cannot be empty.' });

    renderAt(<CreateGameForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Create game' }));

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Name cannot be empty.'));
    expect(navigations_()).toEqual([]);
  });

  it('offers a link to the unfinished game the caller already owns', async () => {
    await insertGame({ name: 'theirs', userId: 'them', started: false });
    // The fixture reads the document straight back, so there is always one.
    const mine = (await insertGame({ name: 'mine', userId: 'me', started: false }))!;

    renderAt(<CreateGameForm />);

    expect(screen.getByRole('link', { name: 'mine' })).toHaveAttribute(
      'href',
      `/games/${mine._id}`
    );
    expect(screen.queryByRole('button', { name: 'Create game' })).not.toBeInTheDocument();
  });

  it('does not count the caller’s finished game as one they still own', async () => {
    await insertGame({ name: 'mine', userId: 'me', started: true, winner: 'me' });

    renderAt(<CreateGameForm />);

    expect(screen.getByRole('button', { name: 'Create game' })).toBeVisible();
  });
});
