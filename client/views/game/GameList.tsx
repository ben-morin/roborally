// The lobby index: every game the `games` publication sends, split into open, active and
// finished. Replaces the `gameList` template.
import type { Mongo } from 'meteor/mongo';
import { Link } from 'react-router';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { Games } from '../../../collections/games.ts';
import type { GameDoc } from '../../../collections/games.ts';
import { paths } from '../routes.ts';
import { formatDate } from '../../helper/datehelper.ts';

// `{winner: null}` is Mongo's "null or missing", so a game in progress counts as open until
// it ends. The two assertions record that: GameDoc types `winner` as an optional string, so
// @types/meteor's selector has no way to accept the null.
const OPEN = { winner: null, started: false } as unknown as Mongo.Selector<GameDoc>;
const ACTIVE = { winner: null, started: true } as unknown as Mongo.Selector<GameDoc>;

// The whole row is the link, so hovering or clicking anywhere on it is hovering or clicking
// the name: the row lifts and the title turns teal together.
const ROW =
  'flex items-baseline justify-between gap-4 rounded-control bg-raised px-4 py-3 text-white hover:bg-raised-hover hover:text-teal';
const TITLE = 'text-lg font-semibold';
const META = 'text-sm text-muted';
const EMPTY = 'text-base text-muted';

function GameRows({ games, meta }: { games: GameDoc[]; meta: (game: GameDoc) => string }) {
  return (
    <ul className="m-0 list-none space-y-2 p-0">
      {games.map((game) => (
        <li key={game._id}>
          <Link className={ROW} to={paths.lobby(game._id)}>
            <span className={TITLE}>{game.name}</span>
            <span className={META}>{meta(game)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function GameList() {
  const isLoading = useSubscribe('games');
  const openGames = useFind(() => Games.find(OPEN, { sort: { submitted: -1 } }));
  const activeGames = useFind(() => Games.find(ACTIVE, { sort: { submitted: -1 } }));
  const endedGames = useFind(() =>
    Games.find({ winner: { $exists: true } }, { sort: { stopped: -1 } })
  );

  // Held back until the subscription lands, so an empty list is an answer rather than a
  // wrong one flashed at the reader — which is what the Blaze version did.
  const loading = isLoading();

  return (
    <>
      <div>
        <h2 className="mt-0 text-3xl">Open games</h2>
        <hr className="star-well mt-3 mb-7" />
        {openGames.length > 0 ? (
          <GameRows games={openGames} meta={(game) => `created ${formatDate(game.submitted)}`} />
        ) : (
          !loading && <p className={EMPTY}>No open games at the moment, create one at the right.</p>
        )}
      </div>
      <div className="mt-10">
        <h3 className="mt-0 text-2xl">Active games</h3>
        <hr className="star-well mt-3 mb-7" />
        {activeGames.length > 0 ? (
          <GameRows games={activeGames} meta={(game) => `created ${formatDate(game.submitted)}`} />
        ) : (
          !loading && <p className={EMPTY}>No active games at the moment</p>
        )}
      </div>
      <div className="mt-10">
        <h3 className="mt-0 text-2xl">Finished games</h3>
        <hr className="star-well mt-3 mb-7" />
        <GameRows
          games={endedGames}
          // `stopped` is written with the winner, so both are there together.
          meta={(game) => `won by ${game.winner} ${formatDate(game.stopped!)}`}
        />
      </div>
    </>
  );
}
