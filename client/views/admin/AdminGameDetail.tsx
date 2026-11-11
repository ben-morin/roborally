// The games manager's right-hand panel: one game — its name, what state it is in, who sits in
// it and whether they are here, the last few chat lines, which is where a parked game says why,
// and the two actions. Each action but Rename asks first; a done one shows nothing, since the
// list shows the result (the name or pill changes, or the row leaves), and a refusal is a modal
// as the server worded it. The server checks each one again; what this hides is only what the
// server would refuse.
import { Fragment, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { GAME_NAME_MAX } from '../../../both/gameName.ts';
import { GameState } from '../../../both/gamestate.ts';
import { adminDeleteGame, adminEndGame, adminRenameGame } from '../../../both/methods/admin.ts';
import { MAX_RESUME_ATTEMPTS } from '../../../collections/games.ts';
import { Chat } from '../../../collections/chat.ts';
import { modalAlert, modalConfirm } from '../../helper/modalDialogs.ts';
import { hasWinner, statusOf } from '../../lib/adminGames.ts';
import type { AdminGameDoc } from '../../lib/adminGames.ts';
import { presenceOf } from '../../lib/adminUsers.ts';
import type { Presence } from '../../lib/adminUsers.ts';
import { AdminPlayers } from './AdminGames.ts';
import { AdminUsers } from './AdminUsers.ts';
import { ChatLines } from '../chat/ChatLines.tsx';
import { RelativeTime } from '../layout/RelativeTime.tsx';
import { UserName } from '../users/UserName.tsx';
import { StatusPill } from './StatusPill.tsx';
import { WonBy } from './WonBy.tsx';

const EYEBROW = 'mb-2 block text-xs font-semibold tracking-[.08em] text-muted uppercase';
const SECTION = 'mt-7 text-left';
const FACTS = 'm-0 grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2 text-sm';
const TERM = 'text-muted';
const LINE = 'flex items-center justify-between gap-3 rounded-control bg-raised px-3 py-2';
const NOTE = 'm-0 text-sm text-muted';
const HINT = 'mt-2 mb-0 text-xs text-muted';
const PILL =
  'inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-bold tracking-[.06em] whitespace-nowrap uppercase';
// The user list's presence colours, plus one for a player whose account was deleted.
const PRESENCE: Record<Presence | 'gone', string> = {
  online: `${PILL} bg-teal text-navy`,
  idle: `${PILL} border border-line bg-raised text-muted`,
  offline: `${PILL} border border-line text-muted`,
  gone: `${PILL} border border-line text-muted`,
};
const INPUT =
  'block h-10 w-full rounded-control border border-white/16 bg-raised px-3 text-sm text-white placeholder:text-muted focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PRIMARY =
  'mt-4 inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-control border-0 bg-brand px-4 text-sm font-semibold text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const CHAT_LINES = 5;
// The chat panel's message box, without its fixed height.
const CHAT = 'rounded-control bg-raised py-1.5 text-sm leading-[1.45]';
const DANGER =
  'inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-control border-0 bg-danger px-4 text-sm font-semibold text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_88%,white)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';

export interface AdminGameDetailProps {
  game: AdminGameDoc;
  onDeleted: () => void;
}

const report = (error: { reason?: string }) => modalAlert(error.reason ?? 'Something went wrong.');

export function AdminGameDetail({ game, onDeleted }: AdminGameDetailProps) {
  const status = statusOf(game, MAX_RESUME_ATTEMPTS);
  // Sorted here: Mongo's order puts every capital before every lower-case letter.
  const seats = [...useFind(() => AdminPlayers.find({ gameId: game._id }), [game._id])].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  const users = useFind(() => AdminUsers.find(), []);
  useSubscribe('chat', game._id);
  const lastLines = useFind(
    () => Chat.find({ gameId: game._id }, { sort: { submitted: -1 }, limit: CHAT_LINES }),
    [game._id]
  );
  const chat = [...lastLines].reverse();
  const running = status === 'live' || status === 'parked';
  const [nameField, setNameField] = useState(game.name);

  const onRename = (event: FormEvent) => {
    event.preventDefault();
    adminRenameGame({ gameId: game._id, name: nameField }).catch(report);
  };

  const onEnd = async () => {
    const question = `End "${game.name}"? Nobody wins, and the players see the game end.`;
    if (!(await modalConfirm(question))) return;
    adminEndGame({ gameId: game._id }).catch(report);
  };

  const onDelete = async () => {
    const won = hasWinner(game);
    const question =
      status === 'waiting'
        ? `Delete "${game.name}"? The players in its lobby lose their seats. This cannot be undone.`
        : `Delete "${game.name}"? Its players' games played${won ? ' and its win' : ''} leave the rankings. This cannot be undone.`;
    if (!(await modalConfirm(question))) return;
    adminDeleteGame({ gameId: game._id }).then(onDeleted, report);
  };

  const facts: [string, ReactNode][] = [
    ['Board', game.boardName],
    ['Owner', <UserName userId={game.userId} name={game.author} />],
    ['Created', <RelativeTime timestamp={game.submitted} />],
  ];
  if (running) {
    const phase =
      game.gamePhase === GameState.PHASE.PLAY ? `play, ${game.playPhase}` : game.gamePhase;
    facts.push(['Turn', `${game.programRound} · ${phase}`]);
    facts.push([
      'Last move',
      game.lastStepAt ? <RelativeTime timestamp={game.lastStepAt.getTime()} /> : 'none',
    ]);
  }
  if (game.resumeAttempts) {
    facts.push(['Failed replays', `${game.resumeAttempts} of ${MAX_RESUME_ATTEMPTS}`]);
  }
  if (status === 'ended') {
    facts.push(['Result', <WonBy game={game} />]);
    if (game.stopped) facts.push(['Ended', <RelativeTime timestamp={game.stopped} />]);
  }

  return (
    <div className="text-left">
      <h2 className="mt-0 mb-0 text-center">
        <span className={EYEBROW}>Game</span>
        <span className="block truncate text-2xl">{game.name}</span>
      </h2>
      <hr className="star-well mt-3 mb-2" />

      <form className={SECTION} onSubmit={onRename} aria-label="Game name">
        <label className={EYEBROW} htmlFor="admin-game-name">
          Name
        </label>
        <input
          id="admin-game-name"
          maxLength={GAME_NAME_MAX}
          className={INPUT}
          value={nameField}
          onChange={(event) => setNameField(event.target.value)}
        />
        <button type="submit" className={PRIMARY}>
          Rename
        </button>
      </form>

      <div className={SECTION}>
        <span className={EYEBROW}>Details</span>
        <dl className={FACTS}>
          <dt className={TERM}>State</dt>
          <dd className="m-0">
            <StatusPill status={status} />
          </dd>
          {facts.map(([term, value]) => (
            <Fragment key={term}>
              <dt className={TERM}>{term}</dt>
              <dd className="m-0">{value}</dd>
            </Fragment>
          ))}
        </dl>
      </div>

      <div className={SECTION}>
        <span className={EYEBROW}>Players</span>
        {seats.length === 0 ? (
          <p className={NOTE}>Nobody is seated.</p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {seats.map((seat) => {
              const user = users.find((u) => u._id === seat.userId);
              const presence = user ? presenceOf(user) : 'gone';
              return (
                <li key={seat._id} className={LINE}>
                  <UserName className="truncate" userId={seat.userId} name={seat.name} />
                  <span className={PRESENCE[presence]}>
                    {presence === 'gone' ? 'no account' : presence}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={SECTION}>
        <span className={EYEBROW}>Last chat</span>
        {chat.length === 0 ? (
          <p className={NOTE}>No chat yet.</p>
        ) : (
          <div className={CHAT}>
            <ChatLines lines={chat} />
          </div>
        )}
      </div>

      <div className={SECTION}>
        <span className={EYEBROW}>Actions</span>
        {running ? (
          <>
            <button type="button" className={DANGER} onClick={onEnd}>
              End game
            </button>
            <p className={HINT}>End the game before you delete it.</p>
          </>
        ) : (
          <button type="button" className={DANGER} onClick={onDelete}>
            Delete game
          </button>
        )}
      </div>
    </div>
  );
}
