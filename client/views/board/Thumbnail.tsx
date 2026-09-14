// A board at preview size: title, the tile grid, and the two corner captions. Used by the
// lobby's selected board and by every choice on the board-select grid.
import type { Board } from '../../../both/board.ts';
import { Tiles } from './Tiles.tsx';

/**
 * Pixels per tile at preview size. It has to agree with the `--tile-size` game.css sets on
 * `.board-thumbnail`, which is what the tiles are drawn at; this is the box those tiles flow
 * into. Both call sites read it from here.
 */
export const PREVIEW_TILE_SIZE = 20;

export interface ThumbnailProps {
  // Undefined while the game document is missing — the lobby's `boardData` helper hands
  // over an empty context between a game being cancelled and the redirect off the page.
  // Blaze drew an empty shell there; there is nothing to draw, so this draws nothing.
  board: Board | undefined;
  width: number;
  height: number;
  // 'selected' on the board-select grid, empty everywhere else.
  extraClass?: string;
}

export function Thumbnail({ board, width, height, extraClass = '' }: ThumbnailProps) {
  if (!board) return null;

  return (
    <>
      <h4>{board.title}</h4>
      {/* The id is the board name: the board-select click handler and the browser journey
          both read the selection off it. */}
      <div
        className={`pointer board-thumbnail ${extraClass}`.trim()}
        id={board.name}
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <Tiles rows={board.tiles} showStart={board.max_player} />
      </div>
      {board.missing ? (
        <span className="players">Not in the catalog</span>
      ) : (
        <>
          <span className="players">
            Players: {board.min_player} - {board.max_player}
          </span>
          <span className="length">Length: {board.length}</span>
        </>
      )}
    </>
  );
}
