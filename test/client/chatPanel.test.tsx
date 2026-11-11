// @vitest-environment jsdom
// The chat panel: the room's messages, the send form, and the button that leaves or closes
// the game. modalDialogs is mocked so the handler's own decisions are what gets asserted.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.ts', () => ({
  modalAlert: vi.fn(),
  modalConfirm: vi.fn(async () => true),
}));

import { ChatPanel } from '../../client/views/chat/ChatPanel.tsx';
import { modalAlert, modalConfirm } from '../../client/helper/modalDialogs.ts';
import { formatFullDate } from '../../client/helper/datehelper.ts';
import { GameState } from '../../both/gamestate.ts';
import { CHAT_GRACE_MS } from '../../both/methods/chat.ts';
import { Chat } from '../../collections/chat.ts';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { navigations_, renderAt, resetRouter, setRoute } from '../helpers/router.tsx';

const scrollTo = vi.fn();

beforeEach(async () => {
  resetFakeCollections();
  resetRouter();
  // jsdom implements no scrolling at all, so the scroll-to-newest effect needs something
  // to call. Asserting on the call is also the only way out here to see that it ran.
  Element.prototype.scrollTo = scrollTo;
  await loginAs('me');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Phase = (typeof GameState.PHASE)[keyof typeof GameState.PHASE];

/** A game the caller is looking at, routed the way FlowRouter would have it. */
async function openGame({
  gamePhase = GameState.PHASE.PROGRAM,
  started = true,
  seated = false,
  route = '/games/',
  stopped,
}: {
  gamePhase?: Phase;
  started?: boolean;
  seated?: boolean;
  route?: string;
  stopped?: number;
} = {}) {
  // The fixture reads the document straight back, so there is always one.
  const game = (await insertGame({ started, gamePhase, stopped }))!;
  if (seated) await insertPlayer(game._id, { userId: 'me', name: 'me', robotId: '0' });
  setRoute(`${route}${game._id}`);
  return game;
}

const exitButton = () => screen.queryByRole('button', { name: /game$/ });

describe('ChatPanel', () => {
  it('tells a player line from a system line', async () => {
    await Chat.insertAsync({ gameId: 'global', message: 'hello', submitted: 1, author: 'me' });
    await Chat.insertAsync({ gameId: 'global', message: 'me joined the game', submitted: 2 });

    const { container } = renderAt(<ChatPanel />);

    expect(screen.getByText('me')).toBeVisible();
    const system = container.querySelectorAll('.messages .system');
    expect(system).toHaveLength(1);
    // `.messages .system` and the display name in it are what the browser journey matches.
    expect(system[0]).toHaveTextContent('me joined the game');
    // A middot stands where a player line has its name.
    expect(system[0]).toHaveTextContent(/^· me joined the game/);
  });

  it('shows the name in white and the message muted', async () => {
    await Chat.insertAsync({ gameId: 'global', message: 'hello', submitted: 1, author: 'ann' });

    renderAt(<ChatPanel />);

    const name = screen.getByText('ann');
    expect(name).toHaveClass('text-white');
    expect(name.parentElement).toHaveClass('text-muted');
  });

  it('stamps each line with its age, and the exact date on hover', async () => {
    const at = Date.now() - 5 * 60_000;
    await Chat.insertAsync({ gameId: 'global', message: 'hello', submitted: at });

    renderAt(<ChatPanel />);

    expect(screen.getByText('5m')).toHaveAttribute('title', formatFullDate(at));
  });

  it('gives back-to-back lines from one player one name and one age', async () => {
    const at = Date.now() - 60_000;
    const said = (message: string, userId: string, submitted: number) =>
      Chat.insertAsync({ gameId: 'global', message, submitted, userId, author: userId });
    await said('hello', 'me', at);
    await said('again', 'me', at + 1_000);
    await said('hi', 'ann', at + 2_000);

    const { container } = renderAt(<ChatPanel />);

    expect(screen.getAllByText('me')).toHaveLength(1);
    // The name's line, then the group's text column that holds both messages.
    expect(screen.getByText('me').parentElement!.parentElement).toHaveTextContent(
      /me hello.*again/
    );
    expect(container.querySelectorAll('.messages time')).toHaveLength(2);
    // The viewer's own name is the teal one.
    expect(screen.getByText('me')).toHaveClass('text-teal');
    expect(screen.getByText('ann')).not.toHaveClass('text-teal');
  });

  it("shows a renamed player's current name on lines stored under the old one", async () => {
    await Meteor.users.insertAsync({ _id: 'ann', profile: { name: 'Annie' } });
    await Chat.insertAsync({
      gameId: 'global',
      message: 'hello',
      submitted: Date.now(),
      userId: 'ann',
      author: 'ann',
    });

    renderAt(<ChatPanel />);

    expect(screen.getByText('Annie')).toBeVisible();
    expect(screen.queryByText('ann')).not.toBeInTheDocument();
  });

  it('scrolls to the newest message', async () => {
    await Chat.insertAsync({ gameId: 'global', message: 'hello', submitted: 1 });

    renderAt(<ChatPanel />);

    expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
  });

  describe('posting', () => {
    it('sends the message to the room and clears the box', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
      const game = await openGame();

      renderAt(<ChatPanel />);
      const box = screen.getByPlaceholderText('Enter a message');
      await userEvent.type(box, 'hello');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));

      expect(call).toHaveBeenCalledWith('addMessage', { gameId: game._id, message: 'hello' });
      await vi.waitFor(() => expect(box).toHaveValue(''));
    });

    it('posts to the global room off a game route', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);

      renderAt(<ChatPanel />);
      await userEvent.type(screen.getByPlaceholderText('Enter a message'), 'hi');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));

      expect(call).toHaveBeenCalledWith('addMessage', { gameId: 'global', message: 'hi' });
    });

    it('sends nothing for an empty message', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);

      renderAt(<ChatPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));

      expect(call).not.toHaveBeenCalled();
    });

    it('keeps the text in the box when the server rejects it', async () => {
      vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'You need to login' });

      renderAt(<ChatPanel />);
      const box = screen.getByPlaceholderText('Enter a message');
      await userEvent.type(box, 'hello');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));

      await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('You need to login'));
      expect(box).toHaveValue('hello');
    });
  });

  describe('after the game ends', () => {
    const endedAt = (stopped: number) => openGame({ gamePhase: GameState.PHASE.ENDED, stopped });
    const form = () => screen.queryByPlaceholderText('Enter a message');

    it('keeps the form open for the last words', async () => {
      await endedAt(Date.now());

      renderAt(<ChatPanel />);

      expect(form()).toBeVisible();
      expect(screen.queryByText('Chat closed')).not.toBeInTheDocument();
    });

    it('swaps the form for a note once the grace is over, without a reload', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        await endedAt(Date.now() - CHAT_GRACE_MS + 1_000);
        renderAt(<ChatPanel />);
        expect(form()).toBeVisible();

        act(() => vi.advanceTimersByTime(1_000));

        expect(form()).not.toBeInTheDocument();
        expect(screen.getByText('Chat closed')).toBeVisible();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows the note at once for a game long over, and keeps the lines', async () => {
      const game = await endedAt(Date.now() - CHAT_GRACE_MS);
      await Chat.insertAsync({ gameId: game._id, message: 'gg', submitted: 1, author: 'ann' });

      renderAt(<ChatPanel />);

      expect(form()).not.toBeInTheDocument();
      expect(screen.getByText('Chat closed')).toBeVisible();
      expect(screen.getByText('ann')).toBeVisible();
    });
  });

  describe('the leave/close button', () => {
    it('is not offered to somebody reading the lobby chat', async () => {
      await openGame();

      renderAt(<ChatPanel />);

      expect(exitButton()).not.toBeInTheDocument();
    });

    it('offers a seated player the way out', async () => {
      await openGame({ seated: true });

      renderAt(<ChatPanel />);

      expect(exitButton()).toHaveTextContent('Leave game');
      expect(exitButton()).toBeEnabled();
    });

    it('reads Close game once the game has ended', async () => {
      await openGame({ gamePhase: GameState.PHASE.ENDED, seated: true });

      renderAt(<ChatPanel />);

      expect(exitButton()).toHaveTextContent('Close game');
      expect(exitButton()).toBeEnabled();
    });

    it('lets an onlooker on the board close it', async () => {
      await openGame({ gamePhase: GameState.PHASE.PLAY, route: '/board/' });

      renderAt(<ChatPanel />);

      expect(exitButton()).toHaveTextContent('Close game');
      expect(exitButton()).toBeEnabled();
    });

    it.each([GameState.PHASE.PLAY, GameState.PHASE.DEAL, GameState.PHASE.RESPAWN])(
      'is disabled during the %s phase',
      async (gamePhase) => {
        await openGame({ gamePhase, seated: true });

        renderAt(<ChatPanel />);

        expect(exitButton()).toBeDisabled();
        expect(exitButton()).toHaveAttribute(
          'title',
          'You can only leave during the program phase'
        );
      }
    );

    it('is enabled again for a game that has not started', async () => {
      await openGame({ gamePhase: GameState.PHASE.PLAY, started: false, seated: true });

      renderAt(<ChatPanel />);

      expect(exitButton()).toBeEnabled();
      expect(exitButton()).not.toHaveAttribute('title');
    });
  });

  describe('leaving', () => {
    it('forfeits after confirmation and returns to the list', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
      const game = await openGame({ seated: true });

      renderAt(<ChatPanel />);
      await userEvent.click(exitButton()!);

      expect(modalConfirm).toHaveBeenCalled();
      expect(call).toHaveBeenCalledWith('leaveGame', { gameId: game._id });
      await vi.waitFor(() => expect(navigations_()).toEqual(['/']));
    });

    it('stays put when the confirmation is declined', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
      vi.mocked(modalConfirm).mockResolvedValueOnce(false);
      await openGame({ seated: true });

      renderAt(<ChatPanel />);
      await userEvent.click(exitButton()!);

      await vi.waitFor(() => expect(modalConfirm).toHaveBeenCalled());
      expect(call).not.toHaveBeenCalled();
      expect(navigations_()).toEqual([]);
    });

    it('returns to the list anyway when the server refuses the leave', async () => {
      vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'Not your game.' });
      await openGame({ seated: true });

      renderAt(<ChatPanel />);
      await userEvent.click(exitButton()!);

      await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Not your game.'));
      // The navigation is recorded by the router on its next render, a tick after the alert.
      await vi.waitFor(() => expect(navigations_()).toEqual(['/']));
    });

    it('just leaves the page for somebody holding no robot', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
      await openGame({ gamePhase: GameState.PHASE.PLAY, route: '/board/' });

      renderAt(<ChatPanel />);
      await userEvent.click(exitButton()!);

      expect(call).not.toHaveBeenCalled();
      expect(modalConfirm).not.toHaveBeenCalled();
      expect(navigations_()).toEqual(['/']);
    });

    it('closes an ended game without asking', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
      await openGame({ gamePhase: GameState.PHASE.ENDED, seated: true });

      renderAt(<ChatPanel />);
      await userEvent.click(exitButton()!);

      expect(call).not.toHaveBeenCalled();
      expect(modalConfirm).not.toHaveBeenCalled();
      expect(navigations_()).toEqual(['/']);
    });
  });
});
