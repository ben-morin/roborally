// The ranking list as the podium draws it: places with the same count share a rank and a
// medal, and each place knows its share of the leader's count. No React, no Meteor, no DOM.

/** What ranking reads from a highscore row, in the server's order, best first. */
export interface Place {
  name: string;
  value: number;
}

export type Medal = 'gold' | 'silver' | 'bronze';

export interface Ranked {
  /** Shared by places with the same count, so 1, 2, 2, 4. */
  rank: number;
  /** For ranks 1 to 3 only. */
  medal?: Medal;
  /** This count as a whole percent of the leader's. */
  share: number;
}

const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];

export function rankPlaces<T extends Place>(places: readonly T[]): (T & Ranked)[] {
  const leader = places[0]?.value ?? 0;
  let rank = 0;
  return places.map((place, i) => {
    if (i === 0 || place.value !== places[i - 1].value) rank = i + 1;
    return {
      ...place,
      rank,
      medal: MEDALS[rank - 1],
      share: leader > 0 ? Math.round((place.value / leader) * 100) : 0,
    };
  });
}
