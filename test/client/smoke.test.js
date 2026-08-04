// @vitest-environment jsdom
// Proves the whole view layer loads under the harness. Every .js in client/views is
// reachable only because client/main.js imports it (Blaze resolves templates by name at
// render time, not through the module graph), so a view module that stops loading is
// invisible until the page renders blank. This is the cheap guard for that.
import { describe, expect, it } from 'vitest';

describe('client view modules', () => {
  it('imports every view module and registers the expected templates', async () => {
    await import('../../client/helper/datehelper.js');
    await import('../../client/views/board/board.js');
    await import('../../client/views/board/thumbnail.js');
    await import('../../client/views/cards/cards.js');
    await import('../../client/views/chat/chat.js');
    await import('../../client/views/game/board_select.js');
    await import('../../client/views/game/game_list.js');
    await import('../../client/views/game/game_page.js');
    await import('../../client/views/ranking/ranking.js');
    await import('../../client/views/users/users.js');

    expect(Object.keys(Template.__templates).sort()).toEqual([
      '_tiles',
      'applicationLayout',
      'board',
      'boardselect',
      'card',
      'cards',
      'chat',
      'gameItemPostForm',
      'gameList',
      'gamePageActions',
      'playerStatus',
      'players',
      'ranking',
      'selectedBoard',
      'thumbnail',
      'usersPill',
    ]);
  });
});
