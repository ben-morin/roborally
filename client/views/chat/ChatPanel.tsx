// The room's messages, the send form, and the button that leaves or closes the game.
// Replaces the `chat` template. `ChatPanel` rather than `Chat` because the collection this
// file reads is `Chat` — the clash `players` → `PlayerList` solved at step 4.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Mongo } from 'meteor/mongo';
import { useNavigate } from 'react-router';
import { useFind, useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { GameState } from '../../../both/gamestate.ts';
import { addMessage } from '../../../both/methods/chat.ts';
import { leaveGame } from '../../../both/methods/games.ts';
import { Chat } from '../../../collections/chat.ts';
import { Games } from '../../../collections/games.ts';
import { Players } from '../../../collections/players.ts';
import type { PlayerDoc } from '../../../collections/players.ts';
import { modalAlert, modalConfirm } from '../../helper/modalDialogs.ts';
import { paths } from '../routes.ts';
import { useRouteName, useRouteParam } from '../useRouteParam.ts';

const INPUT =
  'h-12 w-full rounded-control border border-white/16 bg-raised px-3.5 text-base text-white placeholder:text-muted focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const SEND =
  'h-12 shrink-0 cursor-pointer rounded-control border-0 bg-brand px-4 text-base font-semibold text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const GHOST =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-control border border-white/22 bg-transparent px-4 text-sm font-semibold text-white hover:border-white/40 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-white/22 disabled:hover:bg-transparent';

/** Unchanged from the template's own helper: a local date, then a local `h:mm`. */
function timeToStr(time: number): string {
  const d = new Date(time);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function ChatPanel() {
  const routeGameId = useRouteParam('_id');
  const routeName = useRouteName();
  const navigate = useNavigate();
  const roomId = routeGameId || 'global';
  useSubscribe('chat', roomId);

  // Unfiltered on purpose, as the helper this replaces was: the `chat` publication sends one
  // room, so the local collection is that room.
  const messages = useFind(() => Chat.find());
  const game = useTracker(
    () => (routeGameId ? Games.findOne(routeGameId) : undefined),
    [routeGameId]
  );
  const userId = useTracker(() => Meteor.userId());
  const inGame = useTracker(() => {
    // `{robotId: {$ne: null}}` is Mongo's "neither null nor missing" — a seat taken before
    // the game started has no robot yet. The assertion records that PlayerDoc types
    // `robotId` as an optional string, so the selector type has no way to accept the null.
    const seat = {
      gameId: roomId,
      userId,
      robotId: { $ne: null },
    } as unknown as Mongo.Selector<PlayerDoc>;
    return Boolean(Players.findOne(seat));
  }, [roomId, userId]);

  const gameEnded = game?.gamePhase === GameState.PHASE.ENDED;
  // canLeaveActiveGame(), as it stood: the only thing that holds a player is a started game
  // that has not ended and is not in the program phase.
  const canLeave =
    !game || !game.started || gameEnded || game.gamePhase === GameState.PHASE.PROGRAM;

  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  // The `onRendered` this replaces registered a `Chat.find().observe({added})` and never
  // stopped it, so a handle leaked on every visit to the page. There is no handle now: the
  // count is the dependency and React owns when the effect runs.
  useEffect(() => {
    const printer = scroller.current;
    if (printer) printer.scrollTo({ top: printer.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.length === 0) return;

    addMessage({ gameId: roomId, message: draft }).then(
      () => setDraft(''),
      (error) => modalAlert(error.reason)
    );
  }

  async function onExit() {
    // `game!`: holding a robot in this room means the game document is here too. Where it
    // is not, this throws the TypeError the Blaze handler threw.
    if (inGame && game!.gamePhase !== GameState.PHASE.ENDED) {
      if (
        await modalConfirm(
          'If you leave, you will forfeit the game, are you sure you want to give up?'
        )
      ) {
        leaveGame({ gameId: game!._id }).then(
          () => navigate(paths.gameList()),
          (error) => {
            modalAlert(error.reason);
            navigate(paths.gameList());
          }
        );
      }
    } else {
      navigate(paths.gameList());
    }
  }

  // The template's three-branch `{{#if}}`. Only the leave branch can be disabled: an
  // onlooker watching a board they hold no robot on has nothing to forfeit.
  let exitLabel = null;
  let exitDisabled = false;
  if (gameEnded) {
    exitLabel = 'Close game';
  } else if (inGame) {
    exitLabel = 'Leave game';
    exitDisabled = !canLeave;
  } else if (routeName === 'board.page') {
    exitLabel = 'Close game';
  }

  return (
    <>
      <div className="chat">
        <h3 className="mt-0 text-2xl">Chat</h3>
        <hr className="star-well mt-3 mb-7" />
        <div ref={scroller} className="messages rounded-control bg-raised text-sm leading-[1.45]">
          {messages.map((line) =>
            line.author ? (
              <div key={line._id}>
                <span className="text-muted">[{timeToStr(line.submitted)}]</span>{' '}
                <span className="font-semibold">{line.author}:</span> {line.message}
              </div>
            ) : (
              // `system` is contract: the browser journey matches `.messages .system`.
              <div key={line._id} className="system text-muted">
                [{timeToStr(line.submitted)}] {line.message}
              </div>
            )
          )}
        </div>
      </div>
      <form className="mt-4 flex gap-2" onSubmit={onSubmit}>
        <input
          className={INPUT}
          name="message"
          type="text"
          placeholder="Enter a message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <input className={SEND} type="submit" value="Send" />
      </form>
      {exitLabel && (
        <div className="exit text-center">
          <button
            type="button"
            className={GHOST}
            disabled={exitDisabled}
            title={exitDisabled ? 'You can only leave during the program phase' : undefined}
            onClick={onExit}
          >
            {exitLabel}
          </button>
        </div>
      )}
    </>
  );
}
