// The user manager's list: every account the `adminUsers` publication sends into its own
// client collection, `AdminUsers`, sorted by name, with a filter on name and address, ten to a
// page. A row selects its user; the page decides what selecting means.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useFind } from 'meteor/react-meteor-data';
import { getUsername } from '../../../both/permissions.ts';
import { formatDate } from '../../helper/datehelper.ts';
import { matchesFilter, pageOf, paginate, presenceOf, primaryEmail } from '../../lib/adminUsers.ts';
import type { Presence } from '../../lib/adminUsers.ts';
import { ChevronLeft } from '../icons/ChevronLeft.tsx';
import { ChevronRight } from '../icons/ChevronRight.tsx';
import { ChevronsLeft } from '../icons/ChevronsLeft.tsx';
import { ChevronsRight } from '../icons/ChevronsRight.tsx';
import { Loading } from '../layout/Loading.tsx';
import { AdminUsers } from './AdminUsers.ts';

const INPUT =
  'block h-11 min-w-0 flex-1 rounded-control border border-white/16 bg-raised px-3.5 text-sm text-white placeholder:text-muted focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
// The board-select choice's selected look: a teal border and a teal name.
const ROW =
  'flex cursor-pointer items-center justify-between gap-4 rounded-control border-2 border-transparent bg-raised px-4 py-3 text-white hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const ROW_SELECTED =
  'flex cursor-pointer items-center justify-between gap-4 rounded-control border-2 border-teal bg-raised px-4 py-3 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal [&_.name]:text-teal';
const NAME = 'name truncate text-lg font-semibold';
const EMAIL = 'truncate text-[13px] text-muted';
const META = 'text-xs whitespace-nowrap text-muted';
const EMPTY = 'text-base text-muted';
const ADD =
  'inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-brand px-4 text-sm font-semibold text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PAGER = 'mt-4 flex items-center justify-between gap-2';
// Square icon buttons; the label is the accessible name and the tooltip.
const PAGE_BTN =
  'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-control border border-white/22 bg-transparent p-0 text-white hover:border-white/40 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PAGE_BTN_OFF =
  'inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-control border border-white/22 bg-transparent p-0 text-white opacity-45';
const PILL =
  'inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-bold tracking-[.06em] whitespace-nowrap uppercase';
const PILL_ADMIN = `${PILL} bg-brand text-white`;
const PILL_UNVERIFIED = `${PILL} bg-warning text-white`;
// The footer's presence colours, plus an unfilled one for offline.
const PRESENCE: Record<Presence, string> = {
  online: `${PILL} bg-teal text-navy`,
  idle: `${PILL} border border-line bg-raised text-muted`,
  offline: `${PILL} border border-line text-muted`,
};

function since(date: Date | undefined) {
  return date ? formatDate(date.getTime()) : undefined;
}

export interface UserListProps {
  adminIds: readonly string[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (userId: string) => void;
  onAdd: () => void;
}

// One pager button, off at either end of the list.
function PageButton({
  label,
  icon,
  to,
  off,
  goTo,
}: {
  label: string;
  icon: ReactNode;
  to: number;
  off: boolean;
  goTo: (page: number) => void;
}) {
  return off ? (
    <button type="button" className={PAGE_BTN_OFF} aria-label={label} title={label} disabled>
      {icon}
    </button>
  ) : (
    <button
      type="button"
      className={PAGE_BTN}
      aria-label={label}
      title={label}
      onClick={() => goTo(to)}
    >
      {icon}
    </button>
  );
}

export function UserList({ adminIds, loading, selectedId, onSelect, onAdd }: UserListProps) {
  const [filter, setFilter] = useState('');
  // The page the admin chose, and the selection it was chosen under. A selection made
  // anywhere else — a shared link, a just-added account — opens on that user's page instead;
  // derived here rather than set from an effect, so the list never renders the wrong page first.
  const [chosen, setChosen] = useState<{ page: number; selection: string | null }>({
    page: 1,
    selection: null,
  });
  const users = useFind(() => AdminUsers.find({}, { sort: { 'profile.name': 1 } })) ?? [];
  const shown = users.filter((user) => matchesFilter(user, filter));
  const selectedIndex = selectedId ? shown.findIndex((user) => user._id === selectedId) : -1;
  const wanted =
    chosen.selection !== selectedId && selectedIndex >= 0 ? pageOf(selectedIndex) : chosen.page;
  const { items, page, pageCount } = paginate(shown, wanted);

  const goTo = (target: number) => setChosen({ page: target, selection: selectedId });
  const pick = (userId: string) => {
    setChosen({ page, selection: userId });
    onSelect(userId);
  };

  return (
    <>
      <h2 className="mt-0 text-3xl">Users</h2>
      <hr className="star-well mt-3 mb-7" />
      <div className="mb-4 flex gap-3">
        <input
          type="search"
          className={INPUT}
          aria-label="Filter users"
          placeholder="Filter by name or email"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            goTo(1);
          }}
        />
        <button type="button" className={ADD} onClick={onAdd}>
          Add user
        </button>
      </div>
      {/* Until the publication lands only the online users are here, which would read as
          the whole list. */}
      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <p className={EMPTY}>No users match.</p>
      ) : (
        <>
          <p className={`${META} mt-0 mb-3`}>
            {shown.length === users.length
              ? `${users.length} users`
              : `${shown.length} of ${users.length} users`}
          </p>
          <ul className="m-0 list-none space-y-2 p-0">
            {items.map((user) => {
              const selected = user._id === selectedId;
              const email = primaryEmail(user);
              const presence = presenceOf(user);
              const joined = since(user.createdAt);
              const lastLogin = since(user.status?.lastLogin?.date);
              return (
                <li key={user._id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    data-user={user._id}
                    className={selected ? ROW_SELECTED : ROW}
                    onClick={() => pick(user._id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        pick(user._id);
                      }
                    }}
                  >
                    <div className="min-w-0 text-left">
                      <div className={NAME}>{getUsername(user)}</div>
                      <div className={EMAIL}>{email?.address ?? 'no email address'}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="flex gap-1.5">
                        {adminIds.includes(user._id) && <span className={PILL_ADMIN}>admin</span>}
                        {email && !email.verified && (
                          <span className={PILL_UNVERIFIED}>unverified</span>
                        )}
                        <span className={PRESENCE[presence]}>{presence}</span>
                      </div>
                      <div className={META}>
                        {joined && `joined ${joined} · `}
                        {lastLogin ? `last login ${lastLogin}` : 'never logged in'}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {pageCount > 1 && (
            <nav aria-label="User pages" className={PAGER}>
              <div className="flex gap-2">
                <PageButton
                  label="First page"
                  icon={<ChevronsLeft size={18} />}
                  to={1}
                  off={page === 1}
                  goTo={goTo}
                />
                <PageButton
                  label="Previous page"
                  icon={<ChevronLeft size={18} />}
                  to={page - 1}
                  off={page === 1}
                  goTo={goTo}
                />
              </div>
              <span className={META} aria-live="polite">
                Page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                <PageButton
                  label="Next page"
                  icon={<ChevronRight size={18} />}
                  to={page + 1}
                  off={page === pageCount}
                  goTo={goTo}
                />
                <PageButton
                  label="Last page"
                  icon={<ChevronsRight size={18} />}
                  to={pageCount}
                  off={page === pageCount}
                  goTo={goTo}
                />
              </div>
            </nav>
          )}
        </>
      )}
    </>
  );
}
