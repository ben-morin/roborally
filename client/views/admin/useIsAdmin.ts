// Whether the signed-in user is an admin. Only the server can say: `ADMIN_EMAILS` is a
// private setting and never reaches the browser. So this asks once per login, and the
// answer only hides or shows things — every admin method and publication checks again.
import { useEffect, useState } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { isAdmin } from '../../../both/methods/admin.ts';

/** `false` for a visitor, `undefined` while the server is being asked. */
export function useIsAdmin(): boolean | undefined {
  const userId = useTracker(() => Meteor.userId());
  // Keyed on the user it was asked for, so a different login never reads the last answer.
  const [answer, setAnswer] = useState<{ userId: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let current = true;
    isAdmin().then(
      (result) => current && setAnswer({ userId, isAdmin: result }),
      () => current && setAnswer({ userId, isAdmin: false })
    );
    return () => {
      current = false;
    };
  }, [userId]);

  if (!userId) return false;
  return answer?.userId === userId ? answer.isAdmin : undefined;
}
