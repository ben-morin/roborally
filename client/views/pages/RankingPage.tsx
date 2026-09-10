// `/ranking`: the two highscore lists, with the global chat beside them. The `highscores`
// subscription was the route's; it is this page's now.
import { useSubscribe } from 'meteor/react-meteor-data';
import { ChatPanel } from '../chat/ChatPanel.tsx';
import { Panel } from '../layout/Panel.tsx';
import { Ranking } from '../ranking/Ranking.tsx';

export function RankingPage() {
  useSubscribe('highscores');

  return (
    <div className="cols">
      <Panel>
        <Ranking />
      </Panel>
      <div className="stack right-panel">
        <Panel>
          <ChatPanel />
        </Panel>
      </div>
    </div>
  );
}
