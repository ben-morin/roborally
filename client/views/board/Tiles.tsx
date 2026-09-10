// The board floor: one span per tile, carrying the tile artwork as a background image and
// its walls, lasers, checkpoints and start squares as children. Rendered both full size
// inside `#board` and at preview size inside `.board-thumbnail`; the geometry for either
// comes from game.css, which is why nothing here sizes anything.
import type { CSSProperties } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import type { Tile } from '../../../both/tile.ts';
import { Players } from '../../../collections/players.ts';

export interface TilesProps {
  rows: Tile[][];
  // The board passes `false`; the thumbnail passes the board's player capacity, and a
  // start square is drawn only up to that number.
  showStart: number | false;
}

// The items sit inside the tile span, so their direction is relative to the tile's own
// orientation — hence a transform rather than four artwork variants.
function rotation(direction: number): CSSProperties {
  const rotate = `rotate(${90 * direction}deg)`;
  return { transform: rotate, WebkitTransform: rotate, msTransform: rotate };
}

export function Tiles({ rows, showStart }: TilesProps) {
  // Checkpoints are numbered from 1, so 0 stands in for both "not playing here" and
  // "none reached yet" — the comparison below is the same either way.
  const visitedCheckpoints = useTracker(() => {
    const userId = Meteor.userId();
    if (!userId) return 0;
    return Players.findOne({ userId })?.visited_checkpoints ?? 0;
  });

  return (
    <>
      {rows.map((row, y) =>
        row.map((tile, x) => {
          const start = tile.start ?? 0;
          return (
            <span
              key={`${y}-${x}`}
              className="tile"
              style={{ backgroundImage: `url('${tile.path()}')`, ...rotation(tile.direction) }}
            >
              {tile.items.map((item, i) => (
                <img
                  key={i}
                  className="board-item"
                  src={item.path}
                  style={rotation(item.direction)}
                />
              ))}
              {tile.finish ? (
                <div>
                  <img className="board-item" src="/finish.png" />
                </div>
              ) : null}
              {tile.checkpoint ? (
                <div
                  className={`checkpoint${visitedCheckpoints >= tile.checkpoint ? ' visited' : ''}`}
                >
                  <div className="checkpoint-text-container">
                    <div className="checkpoint-text">{tile.checkpoint}</div>
                  </div>
                </div>
              ) : null}
              {showStart !== false && start > 0 && start <= showStart ? (
                <img className="board-item" src="/start.png" />
              ) : null}
            </span>
          );
        })
      )}
    </>
  );
}
