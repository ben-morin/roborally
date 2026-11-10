// `/admin/games`: the games manager — the list on the left, the selected game on the right.
// The selection is the `game` search parameter, so a reload or a shared link keeps it.
import { useSearchParams } from 'react-router';
import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { AdminGames } from '../admin/AdminGames.ts';
import { AdminGameDetail } from '../admin/AdminGameDetail.tsx';
import { AdminGameList } from '../admin/AdminGameList.tsx';
import { Panel } from '../layout/Panel.tsx';

export function AdminGamesPage() {
  const gamesLoading = useSubscribe('adminGames');
  // Presence for the players: who is online is what says whether a game is abandoned.
  const usersLoading = useSubscribe('adminUsers');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('game');
  const selected = useTracker(
    () => (selectedId ? AdminGames.findOne(selectedId) : undefined),
    [selectedId]
  );
  const loading = gamesLoading() || usersLoading();

  // Replacing, so the back button leaves the page instead of walking the selections.
  const select = (gameId: string | null) =>
    setParams(gameId ? { game: gameId } : {}, { replace: true });

  return (
    <div className="cols">
      <Panel>
        <AdminGameList loading={loading} selectedId={selectedId} onSelect={select} />
      </Panel>
      <div className="stack right-panel">
        <Panel>
          {selected && !loading ? (
            // A fresh panel for each game, so nothing of one shows on another.
            <AdminGameDetail key={selected._id} game={selected} onDeleted={() => select(null)} />
          ) : (
            <p className="m-0 text-center text-muted">Pick a game</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
