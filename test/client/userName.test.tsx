// @vitest-environment jsdom
// A username as the account has it now: the current name where the `userNames` feed has the
// account, the stored name otherwise, and a deleted account marked once the feed has landed.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserName, UserNamesReady } from '../../client/views/users/UserName.tsx';
import { resetFakeCollections } from '../setup.js';

beforeEach(async () => {
  resetFakeCollections();
  await Meteor.users.insertAsync({ _id: 'ann', profile: { name: 'Annie' } });
});
afterEach(cleanup);

const withFeed = (ui: React.ReactNode) =>
  render(<UserNamesReady.Provider value={true}>{ui}</UserNamesReady.Provider>);

describe('UserName', () => {
  it("shows the account's current name over the stored one", () => {
    render(<UserName userId="ann" name="ann" className="font-semibold" />);

    const name = screen.getByText('Annie');
    expect(name).toHaveClass('font-semibold');
    expect(name).not.toHaveAttribute('data-deleted');
    expect(name).not.toHaveAttribute('title');
  });

  it('shows the stored name for a row stored without an account', () => {
    withFeed(<UserName name="Nobody" />);

    expect(screen.getByText('Nobody')).not.toHaveAttribute('data-deleted');
  });

  it('shows the stored name, unmarked, until the feed lands', () => {
    render(<UserName userId="gone" name="bob" />);

    expect(screen.getByText('bob')).not.toHaveAttribute('data-deleted');
  });

  it('marks a deleted account once the feed has landed', () => {
    withFeed(<UserName userId="gone" name="bob" />);

    const name = screen.getByText('bob');
    expect(name).toHaveAttribute('data-deleted');
    expect(name).toHaveAttribute('title', 'Account deleted');
  });
});
