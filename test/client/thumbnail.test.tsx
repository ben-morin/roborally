// @vitest-environment jsdom
// The board preview. Its `id` is contract: the board-select click handler and the browser
// journey both read the chosen board's name off it.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Thumbnail } from '../../client/views/board/Thumbnail.tsx';
import { BoardBox } from '../../both/board_box.ts';
import { loginAs, resetFakeCollections } from '../setup.js';

beforeEach(async () => {
  resetFakeCollections();
  await loginAs('me');
});
afterEach(cleanup);

const defaultBoard = () => BoardBox.getBoard('default');

describe('Thumbnail', () => {
  it('names the board on the element the click handler reads', () => {
    const { container } = render(<Thumbnail board={defaultBoard()} width={288} height={384} />);

    const preview = container.querySelector('.board-thumbnail');
    expect(preview).toHaveAttribute('id', 'default');
    expect(preview).toHaveStyle({ width: '288px', height: '384px' });
  });

  it('shows the title and the two captions', () => {
    const board = defaultBoard();

    render(<Thumbnail board={board} width={288} height={384} />);

    expect(screen.getByRole('heading', { name: board.title })).toBeInTheDocument();
    expect(screen.getByText(`Players: ${board.min_player} - ${board.max_player}`)).toBeVisible();
    expect(screen.getByText(`Length: ${board.length}`)).toBeVisible();
  });

  it('carries the caller’s extra class, and only its own two without one', () => {
    const { container, rerender } = render(
      <Thumbnail board={defaultBoard()} width={10} height={10} />
    );
    expect(container.querySelector('.board-thumbnail')).toHaveAttribute(
      'class',
      'pointer board-thumbnail'
    );

    rerender(<Thumbnail board={defaultBoard()} width={10} height={10} extraClass="selected" />);
    expect(container.querySelector('.board-thumbnail')).toHaveClass('selected');
  });

  it('draws the board’s tiles, with a start square for every seat', () => {
    const board = defaultBoard();

    const { container } = render(<Thumbnail board={board} width={288} height={384} />);

    expect(container.querySelectorAll('span.tile')).toHaveLength(board.width * board.height);
    expect(container.querySelectorAll('img[src="/start.png"]')).toHaveLength(board.max_player);
  });

  it('draws nothing while the game document is missing', () => {
    const { container } = render(<Thumbnail board={undefined} width={0} height={0} />);

    expect(container).toBeEmptyDOMElement();
  });
});
