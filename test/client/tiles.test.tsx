// @vitest-environment jsdom
// The board floor. Everything here is markup that game.css keys off — class names, the
// tile artwork, the rotation transform — so the assertions are deliberately literal.
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Tiles } from '../../client/views/board/Tiles.tsx';
import { GameLogic } from '../../both/gamelogic.ts';
import { Tile } from '../../both/tile.ts';
import { insertPlayer } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';

beforeEach(async () => {
  resetFakeCollections();
  await loginAs('me');
});
afterEach(cleanup);

/** One row of freshly built tiles, which is the only shape `Tiles` reads. */
const row = (...tiles: Tile[]) => [tiles];

const styleOf = (element: Element | null) => (element as HTMLElement).style;

describe('Tiles', () => {
  it('draws one span per tile, carrying the tile artwork', () => {
    const { container } = render(
      <Tiles rows={row(new Tile(), new Tile(Tile.REPAIR))} showStart={false} />
    );

    const spans = container.querySelectorAll('span.tile');
    expect(spans).toHaveLength(2);
    expect(styleOf(spans[0]).backgroundImage).toContain('/tiles/empty.jpg');
    expect(styleOf(spans[1]).backgroundImage).toContain('/tiles/repair.jpg');
  });

  it('rotates a tile by its direction', () => {
    const tile = new Tile();
    tile.direction = GameLogic.DOWN;

    const { container } = render(<Tiles rows={row(tile)} showStart={false} />);

    expect(styleOf(container.querySelector('span.tile')).transform).toBe('rotate(180deg)');
  });

  it('draws every item on the tile, rotated relative to it', () => {
    const tile = new Tile();
    tile.addWall(GameLogic.RIGHT);
    tile.addLaser(GameLogic.LEFT, 2);

    const { container } = render(<Tiles rows={row(tile)} showStart={false} />);

    const items = container.querySelectorAll('img.board-item');
    expect([...items].map((img) => img.getAttribute('src'))).toEqual([
      '/tiles/wall.png',
      '/tiles/doublelaser.png',
    ]);
    expect(styleOf(items[0]).transform).toBe('rotate(90deg)');
    expect(styleOf(items[1]).transform).toBe('rotate(270deg)');
  });

  it('marks a checkpoint the viewer has reached, and leaves the rest plain', async () => {
    await insertPlayer('g1', { userId: 'me', visited_checkpoints: 2 });
    const reached = new Tile();
    reached.addCheckpoint(2);
    const ahead = new Tile();
    ahead.addCheckpoint(3);

    const { container } = render(<Tiles rows={row(reached, ahead)} showStart={false} />);

    const checkpoints = container.querySelectorAll('div.checkpoint');
    expect(checkpoints[0]).toHaveClass('visited');
    expect(checkpoints[0]).toHaveTextContent('2');
    expect(checkpoints[1]).not.toHaveClass('visited');
  });

  it('marks nothing for an onlooker holding no robot', () => {
    const tile = new Tile();
    tile.addCheckpoint(1);

    const { container } = render(<Tiles rows={row(tile)} showStart={false} />);

    expect(container.querySelector('div.checkpoint')).not.toHaveClass('visited');
  });

  it('draws the finish marker on a checkpoint tile', () => {
    const tile = new Tile();
    tile.addCheckpoint(1);

    const { container } = render(<Tiles rows={row(tile)} showStart={false} />);

    expect(container.querySelector('img[src="/finish.png"]')).toBeInTheDocument();
  });

  it('draws start squares only up to the number of players the board takes', () => {
    const first = new Tile();
    first.addStart(1);
    const ninth = new Tile();
    ninth.addStart(9);

    const { container } = render(<Tiles rows={row(first, ninth)} showStart={8} />);

    expect(container.querySelectorAll('img[src="/start.png"]')).toHaveLength(1);
  });

  it('draws no start square at all for a board in play', () => {
    const tile = new Tile();
    tile.addStart(1);

    const { container } = render(<Tiles rows={row(tile)} showStart={false} />);

    expect(container.querySelector('img[src="/start.png"]')).not.toBeInTheDocument();
  });
});
