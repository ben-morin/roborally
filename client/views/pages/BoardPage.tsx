// `/board/:_id`: the board on the left; the card panel and the game's chat on the right.
// The three subscriptions were the route's and are this page's now. Subscribing to
// `players` is also what tells the server somebody is waiting on this game — see
// server/publications.ts.
import { useSubscribe } from 'meteor/react-meteor-data';
import { Board } from '../board/Board.tsx';
import { CardPanel } from '../cards/CardPanel.tsx';
import { ChatPanel } from '../chat/ChatPanel.tsx';
import { Panel } from '../layout/Panel.tsx';
import { useRouteParam } from '../useRouteParam.ts';

export function BoardPage() {
  const gameId = useRouteParam('_id');
  useSubscribe('games');
  useSubscribe(gameId ? 'players' : undefined, gameId);
  useSubscribe(gameId ? 'cards' : undefined, gameId);

  return (
    <div className="cols">
      <Panel tight>
        <Board />
      </Panel>
      {/* `right-panel` is contract: the browser journey reads the phase heading under it. */}
      <div className="stack right-panel">
        {/* The card panel writes `data-countdown` on its root, and the panel's stylesheet
            recolours itself from that through `:has()`. */}
        <Panel>
          <CardPanel />
        </Panel>
        <Panel>
          <ChatPanel />
        </Panel>
      </div>
    </div>
  );
}
