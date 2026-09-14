// The board the game will be played on, at preview size, with the owner's way into the
// board-select page. Replaces the `selectedBoard` template.
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { BoardBox } from '../../../both/board_box.ts';
import { Games } from '../../../collections/games.ts';
import { PREVIEW_TILE_SIZE, Thumbnail } from '../board/Thumbnail.tsx';
import { paths } from '../routes.ts';
import { useRouteParam } from '../useRouteParam.ts';

// The thumbnail's own title and captions, per the design: 18px 600 and a 13px muted meta
// row. They belong to Thumbnail, which board select styles differently, so each call site
// says what it wants.
const PREVIEW = '[&_h4]:text-lg [&_h4]:font-semibold [&_span]:text-[13px] [&_span]:text-muted';
const CHANGE_BOARD =
  'inline-flex h-10 items-center justify-center rounded-control border border-white/22 px-4 text-sm font-semibold text-white no-underline hover:border-white/40 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';

export function SelectedBoard() {
  const gameId = useRouteParam('_id');
  const navigate = useNavigate();
  useSubscribe('games');
  const game = useTracker(() => (gameId ? Games.findOne(gameId) : undefined), [gameId]);
  const userId = useTracker(() => Meteor.userId());

  // Through the client's getter, not `game.board()`: a name the catalog lost still draws.
  const board = game ? BoardBox.getBoardOrPlaceholder(game.boardName) : undefined;

  function onSelect(event: MouseEvent) {
    event.preventDefault();
    if (game) navigate(paths.boardSelect(game._id));
  }

  return (
    <>
      <h3 className="mt-0 text-2xl">Board</h3>
      {/* clear: both, because the panel above it ends in floated captions of its own. */}
      <div className={`selected-board ${PREVIEW}`} style={{ clear: 'both' }}>
        <Thumbnail
          board={board}
          width={(board?.width ?? 0) * PREVIEW_TILE_SIZE}
          height={(board?.height ?? 0) * PREVIEW_TILE_SIZE}
        />
      </div>
      {game && game.userId === userId && (
        // The captions inside .selected-board float, so this row has to clear them; the
        // Blaze version did not and the button sat on top of them.
        <p className="mt-4 clear-both text-center">
          {/* `select` is contract: the browser journey clicks `a.select`. */}
          <a className={`${CHANGE_BOARD} select`} href="#" onClick={onSelect}>
            Change board
          </a>
        </p>
      )}
    </>
  );
}
