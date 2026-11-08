// The user manager's list: every account the `adminUsers` publication sends into its own
// client collection, `AdminUsers`, sorted by name, with a filter on name and address. A row
// selects its user; the page decides what selecting means.
import { useState } from 'react';
import { useFind } from 'meteor/react-meteor-data';
import { getUsername } from '../../../both/permissions.ts';
import { formatDate } from '../../helper/datehelper.ts';
import { matchesFilter, presenceOf, primaryEmail } from '../../lib/adminUsers.ts';
import type { Presence } from '../../lib/adminUsers.ts';
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

export function UserList({ adminIds, loading, selectedId, onSelect, onAdd }: UserListProps) {
  const [filter, setFilter] = useState('');
  const users = useFind(() => AdminUsers.find({}, { sort: { 'profile.name': 1 } })) ?? [];
  const shown = users.filter((user) => matchesFilter(user, filter));

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
          onChange={(event) => setFilter(event.target.value)}
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
            {shown.map((user) => {
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
                    onClick={() => onSelect(user._id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(user._id);
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
        </>
      )}
    </>
  );
}
