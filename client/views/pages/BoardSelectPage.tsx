// `/select/:_id`: the board catalog on the left, the lobby's actions and seats on the
// right. The route used to hold the page on the loading template until its two
// subscriptions landed, then send an unknown game home and a started one to its board;
// the same three steps, in the same order, as one component.
import { Navigate } from 'react-router';
import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { Games } from '../../../collections/games.ts';
import { BoardSelect } from '../game/BoardSelect.tsx';
import { GameActions } from '../game/GameActions.tsx';
import { PlayerList } from '../game/PlayerList.tsx';
import { Loading } from '../layout/Loading.tsx';
import { Panel } from '../layout/Panel.tsx';
import { paths } from '../routes.ts';
import { useRouteParam } from '../useRouteParam.ts';

export function BoardSelectPage() {
  const gameId = useRouteParam('_id');
  const gamesLoading = useSubscribe('games')();
  const playersLoading = useSubscribe(gameId ? 'players' : undefined, gameId)();
  const game = useTracker(() => (gameId ? Games.findOne(gameId) : undefined), [gameId]);

  if (gamesLoading || playersLoading) return <Loading />;
  if (!game || !gameId) return <Navigate to={paths.gameList()} replace />;
  if (game.started) return <Navigate to={paths.board(gameId)} replace />;

  return (
    <div className="cols cols-wide">
      <Panel>
        <BoardSelect />
      </Panel>
      <div className="stack right-panel">
        <Panel>
          <GameActions />
        </Panel>
        <Panel>
          <PlayerList />
        </Panel>
      </div>
    </div>
  );
}
