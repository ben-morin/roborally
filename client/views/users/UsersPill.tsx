// The footer's presence strip: one pill per user the `onlineUsers` publication sends.
// That publication carries `profile.name` and presence and nothing else, so the label
// comes from getUsername rather than from an address.
import { useTracker } from 'meteor/react-meteor-data';
import { getUsername } from '../../../both/permissions.ts';

// The name stays as typed — no uppercase — which is what sets a user pill apart from the
// status pills on the card panel. Each state carries the whole of its own colour.
const PILL =
  'users-pill inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap';
const ONLINE = 'bg-teal text-navy';
const IDLE = 'border border-line bg-raised text-muted';

export function UsersPill() {
  const users = useTracker(() => (Meteor.userId() ? Meteor.users.find().fetch() : []));

  return users.map((user) => {
    const idle = Boolean(user.status?.idle);
    return (
      <span
        key={user._id}
        className={`${PILL} ${idle ? IDLE : ONLINE}`}
        title={idle ? 'idle' : 'online'}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${idle ? 'bg-muted' : 'bg-navy'}`}
          aria-hidden="true"
        />
        {getUsername(user)}
      </span>
    );
  });
}
