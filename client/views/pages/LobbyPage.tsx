// `/games/:_id`: the lobby — its chat on the left; the actions, the seats and the chosen
// board on the right. Once the game starts, the page is the board's: a replacing redirect,
// so the back button does not bounce the player forward again. The route used to do this
// in its action; the `gamePageActions` autorun did it a second time, and that copy is gone.
import { Navigate } from 'react-router';
import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { Games } from '../../../collections/games.ts';
import { ChatPanel } from '../chat/ChatPanel.tsx';
import { GameActions } from '../game/GameActions.tsx';
import { PlayerList } from '../game/PlayerList.tsx';
import { SelectedBoard } from '../game/SelectedBoard.tsx';
import { Panel } from '../layout/Panel.tsx';
import { paths } from '../routes.ts';
import { useRouteParam } from '../useRouteParam.ts';

export function LobbyPage() {
  const gameId = useRouteParam('_id');
  useSubscribe('games');
  const started = useTracker(() => Boolean(gameId && Games.findOne(gameId)?.started), [gameId]);

  if (started && gameId) return <Navigate to={paths.board(gameId)} replace />;

  return (
    <div className="cols">
      <Panel>
        <ChatPanel />
      </Panel>
      <div className="stack right-panel">
        <Panel>
          <GameActions />
        </Panel>
        <Panel>
          <PlayerList />
        </Panel>
        <Panel>
          <SelectedBoard />
        </Panel>
      </div>
    </div>
  );
}
