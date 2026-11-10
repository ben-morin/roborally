// The games manager's list: every game the `adminGames` publication sends into `AdminGames`,
// newest first, with a filter by state and one by text, ten to a page. A row selects its
// game; the page decides what selecting means.
import { useState } from 'react';
import { useFind } from 'meteor/react-meteor-data';
import { MAX_RESUME_ATTEMPTS } from '../../../collections/games.ts';
import { formatDate } from '../../helper/datehelper.ts';
import {
  countByStatus,
  matchesGameFilter,
  plural,
  STATUS_LABELS,
  STATUSES,
  statusOf,
  wonBy,
} from '../../lib/adminGames.ts';
import type { AdminGameDoc, AdminPlayerDoc, GameStatus } from '../../lib/adminGames.ts';
import { Loading } from '../layout/Loading.tsx';
import { AdminGames, AdminPlayers } from './AdminGames.ts';
import { AdminUsers } from './AdminUsers.ts';
import { Pager } from './Pager.tsx';
import { StatusPill } from './StatusPill.tsx';
import { usePagedSelection } from './usePagedSelection.ts';

const INPUT =
  'block h-11 w-full min-w-0 rounded-control border border-white/16 bg-raised px-3.5 text-sm text-white placeholder:text-muted focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
// The admin shell's link track, as buttons: these filter one list rather than open a page.
const TRACK = 'mb-4 inline-flex flex-wrap gap-1 rounded-[22px] bg-raised p-1';
const FILTER =
  'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border-0 px-3.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const FILTER_ON = `${FILTER} bg-teal text-navy`;
const FILTER_OFF = `${FILTER} bg-transparent text-white/70 hover:bg-raised-hover hover:text-white`;
const FILTER_COUNT = 'text-xs font-normal opacity-80';
// The user list's row, with its selected look: a teal border and a teal name.
const ROW =
  'flex cursor-pointer items-center justify-between gap-4 rounded-control border-2 border-transparent bg-raised px-4 py-3 text-white hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const ROW_SELECTED =
  'flex cursor-pointer items-center justify-between gap-4 rounded-control border-2 border-teal bg-raised px-4 py-3 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal [&_.name]:text-teal';
const NAME = 'name truncate text-lg font-semibold';
const SUB = 'truncate text-[13px] text-muted';
const META = 'text-xs whitespace-nowrap text-muted';
const EMPTY = 'text-base text-muted';

type Filter = GameStatus | 'all';

export interface AdminGameListProps {
  loading: boolean;
  selectedId: string | null;
  onSelect: (gameId: string) => void;
}

// What a row says under its pill: who is there while it runs, how it ended once it is over.
function metaOf(game: AdminGameDoc, status: GameStatus, seated: number, online: number) {
  if (status === 'ended') {
    return game.stopped ? `${wonBy(game)} · ended ${formatDate(game.stopped)}` : wonBy(game);
  }
  if (status === 'waiting') {
    return `${plural(seated, 'player')} · created ${formatDate(game.submitted)}`;
  }
  const lastMove = game.lastStepAt ? ` · last move ${formatDate(game.lastStepAt.getTime())}` : '';
  return `${plural(seated, 'player')} · ${online} online${lastMove}`;
}

export function AdminGameList({ loading, selectedId, onSelect }: AdminGameListProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const games = useFind(() => AdminGames.find({}, { sort: { submitted: -1 } })) ?? [];
  const players = useFind(() => AdminPlayers.find()) ?? [];
  const users = useFind(() => AdminUsers.find()) ?? [];

  const seatsOf = new Map<string, AdminPlayerDoc[]>();
  for (const player of players) {
    seatsOf.set(player.gameId, [...(seatsOf.get(player.gameId) ?? []), player]);
  }
  const online = new Set(users.filter((user) => user.status?.online).map((user) => user._id));
  const counts = countByStatus(games, MAX_RESUME_ATTEMPTS);
  const shown = games.filter(
    (game) =>
      (filter === 'all' || statusOf(game, MAX_RESUME_ATTEMPTS) === filter) &&
      matchesGameFilter(game, seatsOf.get(game._id) ?? [], text)
  );
  const { items, page, pageCount, goTo, pick } = usePagedSelection(shown, selectedId, onSelect);

  const filters: { value: Filter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: games.length },
    ...STATUSES.map((status) => ({
      value: status,
      label: STATUS_LABELS[status],
      count: counts[status],
    })),
  ];

  return (
    <>
      <h2 className="mt-0 text-3xl">Games</h2>
      <hr className="star-well mt-3 mb-7" />
      <div className={TRACK} role="group" aria-label="Show games">
        {filters.map(({ value, label, count }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className={filter === value ? FILTER_ON : FILTER_OFF}
            onClick={() => {
              setFilter(value);
              goTo(1);
            }}
          >
            {label}
            <span className={FILTER_COUNT}>{count}</span>
          </button>
        ))}
      </div>
      <div className="mb-4">
        <input
          type="search"
          className={INPUT}
          aria-label="Filter games"
          placeholder="Filter by game, board or player"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            goTo(1);
          }}
        />
      </div>
      {/* Until both publications land, a partial list would read as the whole one. */}
      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <p className={EMPTY}>No games match.</p>
      ) : (
        <>
          <p className={`${META} mt-0 mb-3`}>
            {shown.length === games.length
              ? plural(games.length, 'game')
              : `${shown.length} of ${plural(games.length, 'game')}`}
          </p>
          <ul className="m-0 list-none space-y-2 p-0">
            {items.map((game) => {
              const selected = game._id === selectedId;
              const status = statusOf(game, MAX_RESUME_ATTEMPTS);
              const seats = seatsOf.get(game._id) ?? [];
              const here = seats.filter((seat) => online.has(seat.userId)).length;
              return (
                <li key={game._id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    data-game={game._id}
                    className={selected ? ROW_SELECTED : ROW}
                    onClick={() => pick(game._id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        pick(game._id);
                      }
                    }}
                  >
                    <div className="min-w-0 text-left">
                      <div className={NAME}>{game.name}</div>
                      <div className={SUB}>
                        {game.boardName} · {game.author}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusPill status={status} />
                      <div className={META}>{metaOf(game, status, seats.length, here)}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager label="Game pages" page={page} pageCount={pageCount} goTo={goTo} />
        </>
      )}
    </>
  );
}
