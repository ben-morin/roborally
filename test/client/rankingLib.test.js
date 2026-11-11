// The ranking list as the podium draws it: a number and a medal by place, since the server
// has already broken every tie, and each place's share of the leader's count.
import { describe, expect, it } from 'vitest';
import { rankPlaces } from '../../client/lib/ranking.ts';

const places = (...values) => values.map((value, i) => ({ name: `p${i}`, value }));

describe('rankPlaces', () => {
  it('numbers every place in order, a tie too', () => {
    expect(rankPlaces(places(9, 5, 5, 1)).map((place) => place.rank)).toEqual([1, 2, 3, 4]);
  });

  it('gives gold, silver and bronze to places 1 to 3, a tie too, and nothing after', () => {
    const medals = rankPlaces(places(9, 9, 5, 3)).map((place) => place.medal);

    expect(medals).toEqual(['gold', 'silver', 'bronze', undefined]);
  });

  it("measures each count against the leader's, in whole percent", () => {
    const shares = rankPlaces(places(12, 6, 4, 1)).map((place) => place.share);

    expect(shares).toEqual([100, 50, 33, 8]);
  });

  it('keeps the fields it was given', () => {
    const [first] = rankPlaces([{ _id: 'a', name: 'ann', value: 2, rank: 1 }]);

    expect(first).toMatchObject({ _id: 'a', name: 'ann', value: 2, rank: 1 });
  });

  it('returns nothing for no places', () => {
    expect(rankPlaces([])).toEqual([]);
  });
});
