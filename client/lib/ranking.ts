// The ranking list as the podium draws it: each place's medal, and its share of the leader's
// count. The server breaks every tie, so places arrive in order and none share a rank.
// No React, no Meteor, no DOM.

/** What ranking reads from a highscore row, in the server's order, best first. */
export interface Place {
  name: string;
  value: number;
}

export type Medal = 'gold' | 'silver' | 'bronze';

export interface Ranked {
  /** The place in the list, from 1. */
  rank: number;
  /** For places 1 to 3 only. */
  medal?: Medal;
  /** This count as a whole percent of the leader's. */
  share: number;
}

const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];

export function rankPlaces<T extends Place>(places: readonly T[]): (T & Ranked)[] {
  const leader = places[0]?.value ?? 0;
  return places.map((place, index) => ({
    ...place,
    rank: index + 1,
    medal: MEDALS[index],
    share: leader > 0 ? Math.round((place.value / leader) * 100) : 0,
  }));
}
