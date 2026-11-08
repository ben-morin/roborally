// The footer's presence strip: one pill per online user. The label comes from getUsername
// rather than from an address, since `onlineUsers` sends `profile.name` and no email.
// Selected on `status.online`, the publication's own selector, so a user document the
// client holds for any other reason never shows up as a pill.
import { useTracker } from 'meteor/react-meteor-data';
import { getUsername } from '../../../both/permissions.ts';

// The name stays as typed — no uppercase — which is what sets a user pill apart from the
// status pills on the card panel. Each state carries the whole of its own colour; the fill
// alone tells online from idle, with no dot (maintainer's call, 2026-11-07).
const PILL =
  'users-pill inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap';
const ONLINE = 'bg-teal text-navy';
const IDLE = 'border border-line bg-raised text-muted';

export function UsersPill() {
  const users = useTracker(() =>
    Meteor.userId() ? Meteor.users.find({ 'status.online': true }).fetch() : []
  );

  return users.map((user) => {
    const idle = Boolean(user.status?.idle);
    return (
      <span
        key={user._id}
        className={`${PILL} ${idle ? IDLE : ONLINE}`}
        title={idle ? 'idle' : 'online'}
      >
        {getUsername(user)}
      </span>
    );
  });
}
