// @vitest-environment jsdom
// The footer's presence strip. The `onlineUsers` publication sends `profile.name` and
// presence and nothing else, so the label has no address to fall back on — that is what
// getUsername is here for. Only online users get a pill, whatever else the client holds.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsersPill } from '../../client/views/users/UsersPill.tsx';
import { loginAs, logout, resetFakeCollections } from '../setup.js';

beforeEach(async () => {
  resetFakeCollections();
  await loginAs('me');
});
afterEach(cleanup);

describe('UsersPill', () => {
  it('shows nobody until the viewer is logged in', async () => {
    await Meteor.users.insertAsync({ _id: 'other', status: { online: true } });
    logout();

    const { container } = render(<UsersPill />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows one pill per user, labelled with the published display name', async () => {
    await Meteor.users.insertAsync({
      _id: 'other',
      status: { online: true },
      profile: { name: 'Ben' },
    });

    const { container } = render(<UsersPill />);

    expect(screen.getByText('Ben')).toHaveClass('users-pill');
    expect(container.querySelectorAll('.users-pill')).toHaveLength(2);
    // The name alone, no dot in front of it.
    expect(screen.getByText('Ben').childElementCount).toBe(0);
  });

  it('falls back to the id for a user the backfill has not reached', async () => {
    await Meteor.users.insertAsync({ _id: 'u1', status: { online: true } });

    render(<UsersPill />);

    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('colours an idle user differently from an active one', async () => {
    await Meteor.users.insertAsync({
      _id: 'idler',
      profile: { name: 'idler' },
      status: { online: true, idle: true },
    });
    await Meteor.users.insertAsync({
      _id: 'active',
      profile: { name: 'active' },
      status: { online: true, idle: false },
    });

    render(<UsersPill />);

    expect(screen.getByText('idler')).toHaveAttribute('title', 'idle');
    expect(screen.getByText('active')).toHaveAttribute('title', 'online');
  });

  // Whatever else puts a user document in the client — an offline one, or one that never
  // logged in and so carries no presence at all — it gets no pill.
  it('leaves out every user the client holds who is not online', async () => {
    await Meteor.users.insertAsync({
      _id: 'offline',
      profile: { name: 'offline' },
      status: { online: false },
    });
    await Meteor.users.insertAsync({ _id: 'never', profile: { name: 'never' } });

    const { container } = render(<UsersPill />);

    expect(screen.queryByText('offline')).not.toBeInTheDocument();
    expect(screen.queryByText('never')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.users-pill')).toHaveLength(1);
  });
});
