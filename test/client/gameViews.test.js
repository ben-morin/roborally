// @vitest-environment jsdom
// The lobby: the game list, the game page's join/leave/start actions, and board select.
// modalDialogs is mocked here so the handlers' own decisions are what gets asserted; the
// dialogs themselves are tested for real in miscViews.test.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.js', () => ({
  modalAlert: vi.fn(),
  modalConfirm: vi.fn(async () => true),
}));

import '../../client/views/game/board_select.js';
import '../../client/views/game/game_list.js';
import '../../client/views/game/game_page.js';
import { modalAlert, modalConfirm } from '../../client/helper/modalDialogs.js';
import { callHelper, resetClientState, templateEvent } from '../clientSetup.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { navigations_, resetRouter, setRoute } from '../stubs/flow-router.js';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { BoardBox } from '../../both/board_box.js';
import { Games } from '../../collections/games.js';

const formEvent = (fields) => ({
  preventDefault() {},
  target: {
    elements: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v }])),
  },
});

beforeEach(async () => {
  resetFakeCollections();
  resetClientState();
  resetRouter();
  document.body.innerHTML = '';
  await loginAs('me');
});
afterEach(() => vi.clearAllMocks());

describe('game list', () => {
  it('splits games into open, active and ended, newest first', async () => {
    await Games.insertAsync({ name: 'open old', started: false, submitted: 1 });
    await Games.insertAsync({ name: 'open new', started: false, submitted: 2 });
    await Games.insertAsync({ name: 'running', started: true, submitted: 3 });
    await Games.insertAsync({ name: 'done first', started: true, winner: 'ann', stopped: 10 });
    await Games.insertAsync({ name: 'done last', started: true, winner: 'bob', stopped: 20 });

    const names = (cursor) => cursor.fetch().map((g) => g.name);

    // `{winner: null}` is Mongo's "null or missing", so a game in progress counts as open.
    expect(names(callHelper('gameList', 'openGames'))).toEqual(['open new', 'open old']);
    expect(names(callHelper('gameList', 'activeGames'))).toEqual(['running']);
    expect(names(callHelper('gameList', 'endedGames'))).toEqual(['done last', 'done first']);
  });

  it('keeps a finished game out of the open and active lists', async () => {
    await Games.insertAsync({ name: 'done', started: true, winner: 'Nobody', stopped: 1 });

    expect(callHelper('gameList', 'openGames').fetch()).toEqual([]);
    expect(callHelper('gameList', 'activeGames').fetch()).toEqual([]);
  });

  it('finds the unfinished game the caller already owns', async () => {
    await Games.insertAsync({ name: 'theirs', userId: 'them', started: false });
    await Games.insertAsync({ name: 'mine', userId: 'me', started: false });

    expect(callHelper('gameItemPostForm', 'gameCreated').name).toBe('mine');
  });

  it('does not count the caller’s finished game as one they still own', async () => {
    await Games.insertAsync({ name: 'mine', userId: 'me', started: true, winner: 'me' });

    expect(callHelper('gameItemPostForm', 'gameCreated')).toBeUndefined();
  });

  it('creates a game from the form and routes to its page', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue('new-id');

    templateEvent('gameItemPostForm', 'submit form')(formEvent({ name: 'my game' }));

    expect(call).toHaveBeenCalledWith('createGame', { name: 'my game' });
    await vi.waitFor(() => expect(navigations_()).toEqual(['game.page?_id=new-id']));
  });

  it('reports a rejected creation instead of navigating', async () => {
    vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'Name cannot be empty.' });

    templateEvent('gameItemPostForm', 'submit form')(formEvent({ name: '' }));

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Name cannot be empty.'));
    expect(navigations_()).toEqual([]);
  });
});

describe('game page actions', () => {
  async function openLobby({ ownerId = 'me', seated = false } = {}) {
    const game = await insertGame({ userId: ownerId, started: false, min_player: 2 });
    if (seated) await insertPlayer(game._id, { userId: 'me', name: 'me' });
    setRoute({ params: { _id: game._id }, name: 'game.page' });
    return game;
  }

  it('recognises the caller as the owner', async () => {
    const game = await openLobby({ ownerId: 'me' });

    expect(callHelper('gamePageActions', 'ownGame', game)).toBe(true);
    expect(callHelper('gamePageActions', 'ownGame', { userId: 'them' })).toBe(false);
  });

  it('knows whether the caller has taken a seat', async () => {
    const game = await openLobby({ seated: true });
    expect(callHelper('gamePageActions', 'inGame', game)).toBeTruthy();

    const empty = await openLobby({ seated: false });
    expect(callHelper('gamePageActions', 'inGame', empty)).toBeFalsy();
  });

  it('is ready with one player and full at eight', async () => {
    const game = await openLobby();
    expect(callHelper('gamePageActions', 'gameReady')).toBe(false);

    for (let i = 0; i < 8; i++) await insertPlayer(game._id, { userId: `p${i}` });
    expect(callHelper('gamePageActions', 'gameReady')).toBe(true);
    expect(callHelper('gamePageActions', 'gameFull')).toBe(true);
  });

  it.each([
    ['join', 'joinGame'],
    ['leave', 'leaveGame'],
    ['start', 'startGame'],
  ])('sends %s to the server', async (cssClass, method) => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const game = await openLobby();

    templateEvent('gamePageActions', `click .${cssClass}`).call(game, { preventDefault() {} });

    expect(call).toHaveBeenCalledWith(method, game._id);
  });

  it('surfaces a rejected start to the player', async () => {
    vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'Too many players.' });
    const game = await openLobby();

    templateEvent('gamePageActions', 'click .start').call(game, { preventDefault() {} });

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Too many players.'));
  });

  it('deletes the game after confirmation and returns to the list', async () => {
    const game = await openLobby();

    await templateEvent('gamePageActions', 'click .delete').call(game, { preventDefault() {} });

    expect(modalConfirm).toHaveBeenCalledWith('Remove this game?');
    expect(await Games.findOneAsync(game._id)).toBeUndefined();
    expect(navigations_()).toEqual(['gamelist.page']);
  });

  it('keeps the game when the confirmation is declined', async () => {
    modalConfirm.mockResolvedValueOnce(false);
    const game = await openLobby();

    await templateEvent('gamePageActions', 'click .delete').call(game, { preventDefault() {} });

    expect(await Games.findOneAsync(game._id)).toBeDefined();
    expect(navigations_()).toEqual([]);
  });
});

describe('lobby player list', () => {
  it('phrases the minimum player count', async () => {
    const solo = await insertGame({ min_player: 1 });
    setRoute({ params: { _id: solo._id } });
    expect(callHelper('players', 'minPlayer')).toBe('One player');

    const pair = await insertGame({ min_player: 3 });
    setRoute({ params: { _id: pair._id } });
    expect(callHelper('players', 'minPlayer')).toBe('3 players');
  });
});

describe('selected board panel', () => {
  it('sizes the thumbnail from the board dimensions', async () => {
    const game = await insertGame({ boardId: 0, userId: 'me' });
    setRoute({ params: { _id: game._id } });

    const data = callHelper('selectedBoard', 'boardData');

    expect(data.width).toBe(game.board().width * 24);
    expect(data.height).toBe(game.board().height * 24);
    expect(data.board.title).toBe(game.board().title);
  });

  it('lets only the owner change the board', async () => {
    const mine = await insertGame({ userId: 'me' });
    setRoute({ params: { _id: mine._id } });
    expect(callHelper('selectedBoard', 'ownGame')).toBe(true);

    const theirs = await insertGame({ userId: 'them' });
    setRoute({ params: { _id: theirs._id } });
    expect(callHelper('selectedBoard', 'ownGame')).toBe(false);
  });

  it('returns an empty panel with no game routed', () => {
    expect(callHelper('selectedBoard', 'boardData')).toEqual({});
  });
});

describe('board select', () => {
  async function openSelect(boardId) {
    const game = await insertGame({ boardId, userId: 'me' });
    setRoute({ params: { _id: game._id }, name: 'boardselect.page' });
    return game;
  }

  it('offers the catalog split into its three categories', async () => {
    await openSelect(0);

    expect(callHelper('boardselect', 'beginnerBoards')).toHaveLength(BoardBox.BEGINNER_COURSE_CNT);
    expect(callHelper('boardselect', 'expertBoards')).toHaveLength(
      BoardBox.CUSTOM_COURSE_IDX - BoardBox.BEGINNER_COURSE_CNT
    );
    expect(callHelper('boardselect', 'customBoards')).toHaveLength(
      BoardBox.CATALOG.length - BoardBox.CUSTOM_COURSE_IDX
    );
  });

  it('marks the currently chosen board and no other', async () => {
    await openSelect(2);

    const chosen = callHelper('boardselect', 'beginnerBoards').filter(
      (b) => b.extra_class === 'selected'
    );

    expect(chosen).toHaveLength(1);
    expect(chosen[0].board.name).toBe(BoardBox.CATALOG[2]);
  });

  it.each([
    [0, ['active', '', '']],
    [BoardBox.BEGINNER_COURSE_CNT, ['', 'active', '']],
    [BoardBox.CUSTOM_COURSE_IDX, ['', '', 'active']],
  ])('opens the tab holding board %i', async (boardId, expected) => {
    await openSelect(boardId);

    expect([
      callHelper('boardselect', 'beginnerActive'),
      callHelper('boardselect', 'expertActive'),
      callHelper('boardselect', 'customActive'),
    ]).toEqual(expected);
  });

  it('defaults to the beginner tab with no game routed', () => {
    expect(callHelper('boardselect', 'beginnerActive')).toBe('active');
  });

  it('sends the clicked board to the server and returns to the game page', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const game = await openSelect(0);
    const target = document.createElement('div');
    target.innerHTML = '<div class="board-thumbnail" id="checkmate"></div>';

    templateEvent(
      'boardselect',
      'click .boardchoice'
    )({
      preventDefault() {},
      currentTarget: target,
    });

    expect(call).toHaveBeenCalledWith('selectBoard', 'checkmate', game._id);
    await vi.waitFor(() => expect(navigations_()).toEqual([`game.page?_id=${game._id}`]));
  });

  it('does nothing when the click lands outside a thumbnail', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    await openSelect(0);

    templateEvent(
      'boardselect',
      'click .boardchoice'
    )({
      preventDefault() {},
      currentTarget: document.createElement('div'),
    });

    expect(call).not.toHaveBeenCalled();
  });
});
