// @vitest-environment jsdom
// The smaller view modules: chat, the shared tile partial, ranking, the online-users
// pill, the layout chrome, the board thumbnail, and the global date helper.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.js', () => ({
  modalAlert: vi.fn(),
  modalConfirm: vi.fn(async () => true),
}));

import '../../client/helper/datehelper.js';
import '../../client/views/board/thumbnail.js';
import '../../client/views/chat/chat.js';
// applicationLayout.js pulls in users.js, which owns the usersPill template.
import '../../client/views/layout/applicationLayout.js';
import '../../client/views/ranking/ranking.js';
import { modalAlert, modalConfirm } from '../../client/helper/modalDialogs.js';
import { callHelper, globalHelper, resetClientState, templateEvent } from '../clientSetup.js';
import { loginAs, logout, resetFakeCollections } from '../setup.js';
import { navigations_, resetRouter, setRoute } from '../stubs/flow-router.js';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { GameState } from '../../both/gamestate.js';
import { Chat } from '../../collections/chat.js';
import { Highscores } from '../../collections/highscores.js';

beforeEach(async () => {
  resetFakeCollections();
  resetClientState();
  resetRouter();
  document.body.innerHTML = '';
  await loginAs('me');
});
afterEach(() => vi.clearAllMocks());

describe('chat', () => {
  it('falls back to the global room off a game route', () => {
    expect(callHelper('chat', 'gameId')).toBe('global');

    setRoute({ params: { _id: 'g1' } });
    expect(callHelper('chat', 'gameId')).toBe('g1');
  });

  it('knows when the board is the page being viewed', () => {
    setRoute({ name: 'game.page' });
    expect(callHelper('chat', 'viewingGame')).toBe(false);

    setRoute({ name: 'board.page' });
    expect(callHelper('chat', 'viewingGame')).toBe(true);
  });

  it('lists the messages in the room', async () => {
    await Chat.insertAsync({ gameId: 'g1', message: 'hello', submitted: 1 });

    expect(callHelper('chat', 'messages').fetch()).toHaveLength(1);
  });

  it('counts a player as in-game only once a robot has been assigned', async () => {
    const game = await insertGame({ started: false });
    setRoute({ params: { _id: game._id } });
    await insertPlayer(game._id, { userId: 'me', name: 'me' });

    // Seated but the game has not started, so there is no robotId yet — and Mongo's
    // `{robotId: {$ne: null}}` does not match a missing field.
    expect(callHelper('chat', 'inGame')).toBeFalsy();

    resetFakeCollections();
    await loginAs('me');
    const started = await insertGame({ started: true });
    setRoute({ params: { _id: started._id } });
    await insertPlayer(started._id, { userId: 'me', name: 'me', robotId: '0' });
    expect(callHelper('chat', 'inGame')).toBeTruthy();
  });

  it('reports the end of the game', async () => {
    const game = await insertGame({ gamePhase: GameState.PHASE.ENDED });
    setRoute({ params: { _id: game._id } });

    expect(callHelper('chat', 'gameEnded')).toBe(true);
  });

  it('reports no end when there is no game route at all', () => {
    expect(callHelper('chat', 'gameEnded')).toBe(false);
  });

  describe('the leave button', () => {
    const state = () => [
      callHelper('chat', 'leaveDisabledClass'),
      callHelper('chat', 'leaveDisabledTitle'),
    ];

    it('is enabled off a game route', () => {
      expect(state()).toEqual(['', '']);
    });

    it('is enabled during the program phase', async () => {
      const game = await insertGame({ started: true, gamePhase: GameState.PHASE.PROGRAM });
      setRoute({ params: { _id: game._id } });

      expect(state()).toEqual(['', '']);
    });

    it.each([GameState.PHASE.PLAY, GameState.PHASE.DEAL, GameState.PHASE.RESPAWN])(
      'is disabled during the %s phase',
      async (gamePhase) => {
        const game = await insertGame({ started: true, gamePhase });
        setRoute({ params: { _id: game._id } });

        expect(state()).toEqual(['disabled', 'You can only leave during the program phase']);
      }
    );

    it('is enabled again once the game has ended', async () => {
      const game = await insertGame({ started: true, gamePhase: GameState.PHASE.ENDED });
      setRoute({ params: { _id: game._id } });

      expect(state()).toEqual(['', '']);
    });

    it('is enabled for a game that has not started', async () => {
      const game = await insertGame({ started: false, gamePhase: GameState.PHASE.PLAY });
      setRoute({ params: { _id: game._id } });

      expect(state()).toEqual(['', '']);
    });
  });

  it('formats a timestamp into a date and time', () => {
    const text = callHelper('chat', 'timeToStr', {}, Date.UTC(2026, 0, 15, 12, 30));

    expect(text).not.toContain('Invalid');
    expect(text).toContain(':');
    expect(text).toContain('2026');
  });

  describe('posting', () => {
    const formEvent = (gameId, message) => ({
      preventDefault() {},
      target: { elements: { gameId: { value: gameId }, message: { value: message } } },
    });

    it('sends the message and clears the input', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
      const event = formEvent('g1', 'hello');

      templateEvent('chat', 'submit form')(event);

      expect(call).toHaveBeenCalledWith('addMessage', { gameId: 'g1', message: 'hello' });
      await vi.waitFor(() => expect(event.target.elements.message.value).toBe(''));
    });

    it('sends nothing for an empty message', () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);

      templateEvent('chat', 'submit form')(formEvent('g1', ''));

      expect(call).not.toHaveBeenCalled();
    });

    it('keeps the text in the box when the server rejects it', async () => {
      vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'You need to login' });
      const event = formEvent('g1', 'hello');

      templateEvent('chat', 'submit form')(event);

      await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('You need to login'));
      expect(event.target.elements.message.value).toBe('hello');
    });
  });

  describe('the forfeit button', () => {
    const clickCancel = (disabled = false) => {
      const el = document.createElement('a');
      if (disabled) el.classList.add('disabled');
      return templateEvent('chat', 'click .cancel')({ currentTarget: el });
    };

    it('does nothing while disabled', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);

      await clickCancel(true);

      expect(call).not.toHaveBeenCalled();
      expect(modalConfirm).not.toHaveBeenCalled();
    });

    it('forfeits after confirmation and returns to the list', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
      const game = await insertGame({ started: true, gamePhase: GameState.PHASE.PROGRAM });
      setRoute({ params: { _id: game._id } });
      await insertPlayer(game._id, { userId: 'me', name: 'me', robotId: '0' });

      await clickCancel();

      expect(modalConfirm).toHaveBeenCalled();
      expect(call).toHaveBeenCalledWith('leaveGame', game._id);
      await vi.waitFor(() => expect(navigations_()).toEqual(['gamelist.page']));
    });

    it('just leaves the page for someone holding no robot', async () => {
      const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
      const game = await insertGame({ started: true, gamePhase: GameState.PHASE.PROGRAM });
      setRoute({ params: { _id: game._id } });

      await clickCancel();

      expect(call).not.toHaveBeenCalled();
      expect(navigations_()).toEqual(['gamelist.page']);
    });
  });
});

describe('tile partial', () => {
  it('marks checkpoints the player has already reached', async () => {
    const game = await insertGame();
    await insertPlayer(game._id, { userId: 'me', visited_checkpoints: 2 });

    expect(callHelper('_tiles', 'visited_checkpoint', {}, 1)).toBe('visited');
    expect(callHelper('_tiles', 'visited_checkpoint', {}, 2)).toBe('visited');
    expect(callHelper('_tiles', 'visited_checkpoint', {}, 3)).toBe('');
  });

  it('marks nothing for a spectator', () => {
    expect(callHelper('_tiles', 'visited_checkpoint', {}, 1)).toBe('');
  });

  it('compares numbers for the template', () => {
    expect(callHelper('_tiles', 'leq', {}, 1, 3)).toBe(true);
    expect(callHelper('_tiles', 'leq', {}, 3, 3)).toBe(true);
    expect(callHelper('_tiles', 'leq', {}, 4, 3)).toBe(false);
  });

  it('builds a prefixed rotation style from a direction', () => {
    const style = callHelper('_tiles', 'rotate', {}, 2);

    expect(style).toBe(
      'transform: rotate(180deg); -webkit-transform: rotate(180deg); -ms-transform: rotate(180deg);'
    );
  });
});

describe('ranking', () => {
  it('splits the two highscore lists', async () => {
    await Highscores.insertAsync({ type: 'mostWon', name: 'ann', value: 2, rank: 1 });
    await Highscores.insertAsync({ type: 'mostPlayed', name: 'bob', value: 9, rank: 1 });

    expect(
      callHelper('ranking', 'mostWon')
        .fetch()
        .map((h) => h.name)
    ).toEqual(['ann']);
    expect(
      callHelper('ranking', 'mostPlayed')
        .fetch()
        .map((h) => h.name)
    ).toEqual(['bob']);
  });
});

describe('online users pill', () => {
  it('lists nobody until the viewer is logged in', () => {
    logout();

    expect(callHelper('usersPill', 'usersOnline')).toEqual([]);
  });

  it('lists the online users once logged in', async () => {
    await Meteor.users.insertAsync({ _id: 'other', status: { online: true } });

    expect(callHelper('usersPill', 'usersOnline').fetch().length).toBeGreaterThan(0);
  });

  // The publication sends `profile.name` and presence and nothing else, so the pill has
  // no address to fall back on — this is the helper that turned the old
  // `{{emails.[0].address}}` into a name.
  it('labels a pill with the published display name', () => {
    expect(callHelper('usersPill', 'userLabel', { _id: 'u1', profile: { name: 'Ben' } })).toBe(
      'Ben'
    );
  });

  it('falls back to the id for a user the backfill has not reached', () => {
    expect(callHelper('usersPill', 'userLabel', { _id: 'u1' })).toBe('u1');
  });

  it('colours an idle user differently from an active one', () => {
    expect(callHelper('usersPill', 'userPillClass', { status: { idle: true } })).toEqual({
      class: 'users-pill badge text-bg-warning',
    });
    expect(callHelper('usersPill', 'userPillClass', { status: { idle: false } })).toEqual({
      class: 'users-pill badge text-bg-success',
    });
    expect(callHelper('usersPill', 'userPillClass', {})).toEqual({
      class: 'users-pill badge text-bg-success',
    });
  });
});

describe('application layout', () => {
  it('reports whether someone is signed in', async () => {
    expect(callHelper('applicationLayout', 'loggingIn')).toBe(true);

    logout();
    expect(callHelper('applicationLayout', 'loggingIn')).toBe(false);
  });

  it('falls back to "development" with no version configured', () => {
    Meteor.settings.public = {};
    expect(callHelper('applicationLayout', 'appVersion')).toBe('development');

    Meteor.settings.public = { appVersion: '3.5.0-1' };
    expect(callHelper('applicationLayout', 'appVersion')).toBe('3.5.0-1');
  });

  it('returns an empty hash when the build did not stamp one', () => {
    expect(callHelper('applicationLayout', 'appHash')).toBe('');

    Meteor.gitCommitHash = 'abc123';
    try {
      expect(callHelper('applicationLayout', 'appHash')).toBe('abc123');
    } finally {
      delete Meteor.gitCommitHash;
    }
  });
});

describe('board thumbnail', () => {
  it('picks the viewer out of the thumbnail’s player list', () => {
    const data = {
      players: [
        { userId: 'them', name: 'them' },
        { userId: 'me', name: 'me' },
      ],
    };

    expect(callHelper('thumbnail', 'player', data).name).toBe('me');
  });

  it('picks nobody when the viewer is not in that game', () => {
    const data = { players: [{ userId: 'them', name: 'them' }] };

    expect(callHelper('thumbnail', 'player', data)).toBeUndefined();
  });
});

describe('formatDate global helper', () => {
  const formatDate = () => globalHelper('formatDate');

  it.each([
    ['30 seconds ago', -30_000, 'second'],
    ['5 minutes ago', -5 * 60_000, 'minute'],
    ['3 hours ago', -3 * 3_600_000, 'hour'],
    ['4 days ago', -4 * 86_400_000, 'day'],
    ['2 months ago', -2 * 2_592_000_000, 'month'],
    ['2 years ago', -2 * 31_536_000_000, 'year'],
  ])('describes %s in %s units', (_label, offset, unit) => {
    const text = formatDate()(Date.now() + offset);

    expect(text).toContain(unit);
    expect(text).toMatch(/ago/);
  });

  it('describes a future timestamp as upcoming', () => {
    expect(formatDate()(Date.now() + 5 * 60_000)).toMatch(/in /);
  });

  it('uses the "now"-style wording for the current instant', () => {
    // numeric: 'auto' renders 0 seconds as "now" rather than "in 0 seconds".
    expect(formatDate()(Date.now())).toBe('now');
  });
});
