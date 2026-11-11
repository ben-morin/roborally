// A username as the account has it now. A row stores the name it was written under; this
// shows the account's current name from the `userNames` feed, so a rename reaches every old
// row at once. The stored name stands in until the feed lands, for a row with no account id,
// and for a deleted account, which also reads gray with hover text.
import { createContext, useContext } from 'react';
import { useTracker } from 'meteor/react-meteor-data';

/** Whether the `userNames` feed has landed, so that a missing account means a deleted one. */
export const UserNamesReady = createContext(false);

// A data attribute and a variant, not a second class string, so the caller's colour stays
// whole in its own const and the deleted gray still wins over it.
const DELETED = 'data-deleted:text-muted';

/**
 * The account's current username from the `userNames` feed, or undefined where the feed has
 * no such account. Reactive inside a tracker. For text a component cannot sit in: `alt`,
 * `aria-label`.
 */
export function accountName(userId: string | undefined): string | undefined {
  return userId ? Meteor.users.findOne(userId)?.profile?.name : undefined;
}

export interface UserNameProps {
  userId?: string;
  /** The name the row stored when it was written. */
  name: string;
  className?: string;
}

export function UserName({ userId, name, className }: UserNameProps) {
  const ready = useContext(UserNamesReady);
  const current = useTracker(() => accountName(userId), [userId]);
  const deleted = ready && userId !== undefined && current === undefined;

  return (
    <span
      className={className ? `${className} ${DELETED}` : DELETED}
      data-deleted={deleted || undefined}
      title={deleted ? 'Account deleted' : undefined}
    >
      {current ?? name}
    </span>
  );
}
