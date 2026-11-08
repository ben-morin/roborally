// Which accounts are admins. Only the server can say, as with `useIsAdmin`. `refresh` asks
// again: an edit can move an address on to the admin list or off it.
import { useCallback, useEffect, useState } from 'react';
import { adminAccountIds } from '../../../both/methods/admin.ts';

export function useAdminAccountIds() {
  const [ids, setIds] = useState<string[]>([]);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let current = true;
    adminAccountIds().then(
      (result) => current && setIds(result),
      // Only an admin is on this page, so a refusal means the rights just went; mark nobody.
      () => current && setIds([])
    );
    return () => {
      current = false;
    };
  }, [asked]);

  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  return [ids, refresh] as const;
}
