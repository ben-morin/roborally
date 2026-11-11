// The chat's grouping: which lines share one name and one age.
import { describe, expect, it } from 'vitest';
import { GROUP_SPAN_MS, groupChat } from '../../client/lib/chat.ts';

const said = (id, userId, submitted) => ({ id, userId, author: userId, submitted });
const system = (id, submitted) => ({ id, submitted });
const ids = (groups) => groups.map((group) => group.map((line) => line.id));

describe('groupChat', () => {
  it('puts back-to-back lines from one player in one group', () => {
    const lines = [said('a', 'ann', 0), said('b', 'ann', 1_000), said('c', 'bob', 2_000)];

    expect(ids(groupChat(lines))).toEqual([['a', 'b'], ['c']]);
  });

  it('never groups a system line, with a player or with another system line', () => {
    const lines = [system('a', 0), system('b', 0), said('c', 'ann', 0), system('d', 0)];

    expect(ids(groupChat(lines))).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('starts a new group after a system line, even for the same player', () => {
    const lines = [said('a', 'ann', 0), system('b', 0), said('c', 'ann', 0)];

    expect(ids(groupChat(lines))).toEqual([['a'], ['b'], ['c']]);
  });

  it('closes a group once it spans more than the limit from its first line', () => {
    const lines = [
      said('a', 'ann', 0),
      said('b', 'ann', GROUP_SPAN_MS - 60_000),
      said('c', 'ann', GROUP_SPAN_MS),
      said('d', 'ann', GROUP_SPAN_MS + 1),
    ];

    expect(ids(groupChat(lines))).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('keeps two accounts apart while they share a name', () => {
    const lines = [said('a', 'ann', 0), { ...said('b', 'ann2', 0), author: 'ann' }];

    expect(ids(groupChat(lines))).toEqual([['a'], ['b']]);
  });

  it("keeps one account's lines together across a rename", () => {
    const lines = [said('a', 'ann', 0), { ...said('b', 'ann', 1_000), author: 'Annie' }];

    expect(ids(groupChat(lines))).toEqual([['a', 'b']]);
  });

  it('groups old lines stored without an account by name', () => {
    const old = (id, author) => ({ id, author, submitted: 0 });
    const lines = [old('a', 'ann'), old('b', 'ann'), old('c', 'bob')];

    expect(ids(groupChat(lines))).toEqual([['a', 'b'], ['c']]);
  });

  it('returns no groups for no lines', () => {
    expect(groupChat([])).toEqual([]);
  });
});
