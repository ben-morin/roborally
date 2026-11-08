// `/admin/users`: the user manager — the list on the left, the selected user on the right.
// The selection is the `user` search parameter, so a reload or a shared link keeps it;
// `user=new` is the Add user form (a Meteor id is never three letters).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { isEmailAvailable } from '../../../both/methods/accounts.ts';
import { AdminUsers } from '../admin/AdminUsers.ts';
import { AddUserForm } from '../admin/AddUserForm.tsx';
import { useAdminAccountIds } from '../admin/useAdminAccountIds.ts';
import { UserDetail } from '../admin/UserDetail.tsx';
import { UserList } from '../admin/UserList.tsx';
import { Panel } from '../layout/Panel.tsx';

const NEW = 'new';

export function AdminUsersPage() {
  const isLoading = useSubscribe('adminUsers');
  const [params, setParams] = useSearchParams();
  const [adminIds, refreshAdminIds] = useAdminAccountIds();
  const [mailAvailable, setMailAvailable] = useState(false);
  const selectedId = params.get('user');
  const adding = selectedId === NEW;
  const selected = useTracker(
    () => (selectedId ? AdminUsers.findOne(selectedId) : undefined),
    [selectedId]
  );
  const myId = useTracker(() => Meteor.userId());

  useEffect(() => {
    let current = true;
    isEmailAvailable().then(
      (available) => current && setMailAvailable(available),
      () => current && setMailAvailable(false)
    );
    return () => {
      current = false;
    };
  }, []);

  // Replacing, so the back button leaves the page instead of walking the selections.
  const select = (userId: string | null) =>
    setParams(userId ? { user: userId } : {}, { replace: true });

  return (
    <div className="cols">
      <Panel>
        <UserList
          adminIds={adminIds}
          loading={isLoading()}
          selectedId={selectedId}
          onSelect={select}
          onAdd={() => select(NEW)}
        />
      </Panel>
      <div className="stack right-panel">
        <Panel>
          {adding ? (
            <AddUserForm
              mailAvailable={mailAvailable}
              onCreated={(userId) => {
                // The address may be one ADMIN_EMAILS lists.
                refreshAdminIds();
                select(userId);
              }}
              onCancel={() => select(null)}
            />
          ) : selected ? (
            <UserDetail
              // A fresh form for each user, so one user's typing never shows on another.
              key={selected._id}
              user={selected}
              isAdmin={adminIds.includes(selected._id)}
              isSelf={selected._id === myId}
              mailAvailable={mailAvailable}
              onChanged={refreshAdminIds}
              onDeleted={() => select(null)}
            />
          ) : (
            <p className="m-0 text-center text-muted">Pick a user</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
