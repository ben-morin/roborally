import { describe, expect, it } from 'vitest';

describe('model imports outside Meteor', () => {
  it('imports every both/ and collections/ module and builds a real board', async () => {
    const { Tile } = await import('../both/tile.ts');
    const { Area } = await import('../both/area.ts');
    const { BoardBox } = await import('../both/board_box.ts');
    const { GameLogic } = await import('../both/gamelogic.ts');
    const { GameState } = await import('../both/gamestate.ts');
    await import('../both/board.ts');
    await import('../both/cardlogic.ts');
    await import('../both/shuffle.ts');
    await import('../both/permissions.ts');
    await import('../collections/cards.ts');
    await import('../collections/chat.ts');
    await import('../collections/deck.ts');
    await import('../collections/games.ts');
    await import('../collections/highscores.ts');
    await import('../collections/players.ts');

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
