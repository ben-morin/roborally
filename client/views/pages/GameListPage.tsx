// `/`: the game lists on the left, the create-game form and the global chat on the right.
import { ChatPanel } from '../chat/ChatPanel.tsx';
import { CreateGameForm } from '../game/CreateGameForm.tsx';
import { GameList } from '../game/GameList.tsx';
import { Panel } from '../layout/Panel.tsx';

export function GameListPage() {
  return (
    <div className="cols">
      <Panel>
        <GameList />
      </Panel>
      <div className="stack right-panel">
        <Panel>
          <CreateGameForm />
        </Panel>
        <Panel>
          <ChatPanel />
        </Panel>
      </div>
    </div>
  );
}
