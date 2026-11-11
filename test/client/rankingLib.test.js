// The ranking list as the podium draws it: shared ranks for shared counts, the medal each
// rank earns, and each place's share of the leader's count.
import { describe, expect, it } from 'vitest';
import { rankPlaces } from '../../client/lib/ranking.ts';

const places = (...values) => values.map((value, i) => ({ name: `p${i}`, value }));
const ranks = (ranked) => ranked.map((place) => place.rank);

describe('rankPlaces', () => {
  it('ranks places in order when every count differs', () => {
    expect(ranks(rankPlaces(places(9, 5, 3, 1)))).toEqual([1, 2, 3, 4]);
  });

  it('gives a tie one rank and skips the places it took', () => {
    expect(ranks(rankPlaces(places(9, 5, 5, 3, 3, 3, 1)))).toEqual([1, 2, 2, 4, 4, 4, 7]);
  });

  it('gives gold, silver and bronze to ranks 1 to 3, shared by a tie, and nothing after', () => {
    const medals = rankPlaces(places(9, 9, 5, 3)).map((place) => place.medal);

    expect(medals).toEqual(['gold', 'gold', 'bronze', undefined]);
  });

  it("measures each count against the leader's, in whole percent", () => {
    const shares = rankPlaces(places(12, 6, 4, 1)).map((place) => place.share);

    expect(shares).toEqual([100, 50, 33, 8]);
  });

  it('keeps the fields it was given', () => {
    const [first] = rankPlaces([{ _id: 'a', name: 'ann', value: 2, rank: 7 }]);

    expect(first).toMatchObject({ _id: 'a', name: 'ann', value: 2, rank: 1 });
  });

  it('returns nothing for no places', () => {
    expect(rankPlaces([])).toEqual([]);
  });
});
