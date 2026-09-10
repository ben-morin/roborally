// The lobby's action panel: who made the game, and the join / start / leave / cancel
// buttons. Replaces the `gamePageActions` template, whose `onCreated` autorun also owned
// the redirect off a cancelled lobby — see the effect below. Its other redirect, to the
// board once the game starts, is the route's (LobbyPage) and is not repeated here.
import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { joinGame, leaveGame, startGame } from '../../../both/methods/games.ts';
import { Games } from '../../../collections/games.ts';
import { Players } from '../../../collections/players.ts';
import { modalAlert, modalConfirm } from '../../helper/modalDialogs.ts';
import { paths } from '../routes.ts';
import { useRouteParam } from '../useRouteParam.ts';

const BTN =
  'inline-flex items-center justify-center rounded-control px-4 font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const BTN_LG = `${BTN} h-12 w-full text-base`;
const BTN_MD = `${BTN} h-10 text-sm`;
const PRIMARY =
  'bg-brand text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] hover:text-white';
const DANGER =
  'bg-danger text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_88%,white)] hover:text-white';
const GHOST = 'border border-white/22 text-white hover:border-white/40 hover:bg-raised';

export function GameActions() {
  const gameId = useRouteParam('_id');
  const navigate = useNavigate();
  const gamesLoading = useSubscribe('games')();
  useSubscribe(gameId ? 'players' : undefined, gameId);

  const game = useTracker(() => (gameId ? Games.findOne(gameId) : undefined), [gameId]);
  const userId = useTracker(() => Meteor.userId());
  const inGame = useTracker(
    () => Boolean(gameId && userId && Players.findOne({ gameId, userId })),
    [gameId, userId]
  );
  // Unfiltered on purpose, as the helpers this replaces were: one game's players are what
  // the `players` publication sends, so the local collection is that game's seats.
  const playerCnt = useTracker(() => Players.find().count());

  // The `gamePageActions.onCreated` autorun. `gameLoaded` is its latch — a game that has
  // not arrived yet must not read as a cancelled one — and `redirected` is its
  // `computation.stop()`, so a re-render inside the same navigation cannot fire twice.
  const gameLoaded = useRef(false);
  const redirected = useRef(false);
  useEffect(() => {
    if (!gameId || redirected.current) return;
    if (game) gameLoaded.current = true;

    if (!game && !gamesLoading) {
      // Cancelled under the reader, or an id that names no game the publication sends —
      // which the route's own `waitOn` guard used to catch before this page rendered.
      redirected.current = true;
      navigate(paths.gameList());
      if (gameLoaded.current) modalAlert('The game was canceled.');
    }
  }, [gameId, game, gamesLoading, navigate]);

  if (!game) return null;

  const ownGame = game.userId === userId;

  const act = (run: () => Promise<unknown>) => (event: MouseEvent) => {
    event.preventDefault();
    run().catch((error) => modalAlert(error.reason));
  };

  const onCancel = async (event: MouseEvent) => {
    event.preventDefault();
    if (await modalConfirm('Remove this game?')) {
      // The one client-side collection write left in the app, and it lands: Games is the
      // only collection whose allow rules permit anything (remove, for the owner). It takes
      // the game document and leaves its players, cards, deck and chat behind. Ported as it
      // stands; it is a P10 item.
      Games.remove(game._id);
      navigate(paths.gameList());
    }
  };

  return (
    <>
      <h2 className="mt-0 mb-0">
        <span className="block text-xs font-semibold tracking-[.08em] text-muted uppercase">
          Game created by
        </span>
        <span className="block text-2xl">{game.author}</span>
      </h2>
      <hr className="star-well mt-3 mb-7" />
      <div className="space-y-3">
        {playerCnt < 8 && !inGame && (
          <a
            className={`${BTN_LG} ${PRIMARY}`}
            href="#"
            onClick={act(() => joinGame({ gameId: game._id }))}
          >
            Join game
          </a>
        )}
        {playerCnt >= 1 && ownGame && (
          // `start` is contract: the browser journey clicks `a.start`.
          <a
            className={`${BTN_LG} ${PRIMARY} start`}
            href="#"
            onClick={act(() => startGame({ gameId: game._id }))}
          >
            Start game
          </a>
        )}
      </div>
      <div className="mt-4 flex justify-center gap-3">
        {inGame && (
          <a
            className={`${BTN_MD} ${GHOST}`}
            href="#"
            onClick={act(() => leaveGame({ gameId: game._id }))}
          >
            Leave game
          </a>
        )}
        {ownGame && (
          <a className={`${BTN_MD} ${DANGER}`} href="#" onClick={onCancel}>
            Cancel game
          </a>
        )}
      </div>
    </>
  );
}
