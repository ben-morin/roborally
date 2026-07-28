import { describe, expect, it } from 'vitest';

describe('model imports outside Meteor', () => {
  it('imports every both/ and collections/ module and builds a real board', async () => {
    const { Tile } = await import('../both/tile.js');
    const { Area } = await import('../both/area.js');
    const { BoardBox } = await import('../both/board_box.js');
    const { GameLogic } = await import('../both/gamelogic.js');
    const { GameState } = await import('../both/gamestate.js');
    await import('../both/board.js');
    await import('../both/cardlogic.js');
    await import('../both/shuffle.js');
    await import('../both/permissions.js');
    await import('../collections/cards.js');
    await import('../collections/chat.js');
    await import('../collections/deck.js');
    await import('../collections/games.js');
    await import('../collections/highscores.js');
    await import('../collections/players.js');

    expect(Tile.ROLLER).toBe('roller');
    expect(Area.course.exchange).toBeTypeOf('function');
    expect(GameLogic.UP).toBe(0);
    expect(GameState.PHASE.IDLE).toBe('waiting');

    const board = BoardBox.getBoard(1); // risky_exchange
    expect(board.title).toBe('Risky Exchange');
    expect(board.checkpoints).toHaveLength(3);
    expect(board.getTile(0, 0)).toBeInstanceOf(Tile);
  });
});
