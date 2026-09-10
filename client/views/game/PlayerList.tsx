// Who has taken a seat, and how many the board wants. Replaces the `players` template.
import { useFind, useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { Games } from '../../../collections/games.ts';
import { Players } from '../../../collections/players.ts';
import { useRouteParam } from '../useRouteParam.ts';

export function PlayerList() {
  const gameId = useRouteParam('_id');
  const gamesLoading = useSubscribe('games')();
  const playersLoading = useSubscribe(gameId ? 'players' : undefined, gameId)();
  // Unfiltered on purpose, as the helper this replaces was: the `players` publication sends
  // one game's seats, so the local collection is that game's.
  const players = useFind(() => Players.find());
  const game = useTracker(() => (gameId ? Games.findOne(gameId) : undefined), [gameId]);

  // The route used to hold the whole page on a `loading` template until the subscriptions
  // landed; the panel says nothing rather than saying something wrong.
  if (gamesLoading || playersLoading) return null;

  const minPlayer = game && game.min_player > 1 ? `${game.min_player} players` : 'One player';

  return (
    <>
      <h3 className="mt-0 text-2xl">Players</h3>
      {players.length > 0 ? (
        <ol className="mt-4 list-none space-y-2 p-0">
          {players.map((player, index) => (
            <li
              key={player._id}
              className="flex items-center gap-3 rounded-control bg-raised px-3 py-2 text-base"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-muted">
                {index + 1}
              </span>
              {player.name}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-base text-muted">nobody joined yet :-(</p>
      )}
      <p className="mt-3 text-sm text-muted">min {minPlayer} recommended to start the game</p>
    </>
  );
}
