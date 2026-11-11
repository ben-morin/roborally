// The games manager's logic half: what state a game is in, what its row says, and whether it
// matches the filter. No React, no Meteor, no DOM — client/views/admin/ is wiring over this.

/** A document of the `adminGames` publication: a game, cut down to what an admin sees. */
export interface AdminGameDoc {
  _id: string;
  name: string;
  userId: string;
  author: string;
  submitted: number;
  started: boolean;
  gamePhase: string;
  playPhase: string;
  programRound: number;
  boardName: string;
  min_player: number;
  max_player: number;
  lastStepAt?: Date | null;
  resumeAttempts?: number;
  winner?: string;
  winnerUserId?: string;
  stopped?: number;
}

/** A document of the `adminGames` publication's second collection: who sits in a game. */
export interface AdminPlayerDoc {
  _id: string;
  gameId: string;
  userId: string;
  name: string;
}

export type GameStatus = 'waiting' | 'live' | 'parked' | 'ended';

/** In the order the filter offers them. */
export const STATUSES: readonly GameStatus[] = ['waiting', 'live', 'parked', 'ended'];

export const STATUS_LABELS: Record<GameStatus, string> = {
  waiting: 'Waiting',
  live: 'Live',
  parked: 'Parked',
  ended: 'Ended',
};

/**
 * Every end-of-game path writes `winner` ('Nobody' included), so its presence is "over". A
 * running game whose turn failed to replay `maxResumeAttempts` times is parked: the server
 * stops trying, and only ending it moves it on. The cap is a parameter so this file needs no
 * Meteor; callers pass `MAX_RESUME_ATTEMPTS`.
 */
export function statusOf(game: AdminGameDoc, maxResumeAttempts: number): GameStatus {
  if (game.winner !== undefined) return 'ended';
  if (!game.started) return 'waiting';
  return (game.resumeAttempts ?? 0) >= maxResumeAttempts ? 'parked' : 'live';
}

/** How many games are in each state. */
export function countByStatus(games: readonly AdminGameDoc[], maxResumeAttempts: number) {
  const counts: Record<GameStatus, number> = { waiting: 0, live: 0, parked: 0, ended: 0 };
  for (const game of games) counts[statusOf(game, maxResumeAttempts)] += 1;
  return counts;
}

/**
 * Case-insensitive, on the game's name, its board, its owner or a player, under the name the
 * game stored or the account's name now (`nameOf`); empty matches all.
 */
export function matchesGameFilter(
  game: AdminGameDoc,
  players: readonly AdminPlayerDoc[],
  filter: string,
  nameOf: (userId: string) => string | undefined = () => undefined
) {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    game.name,
    game.boardName,
    game.author,
    nameOf(game.userId),
    ...players.flatMap((p) => [p.name, nameOf(p.userId)]),
  ];
  return haystack.some((text) => (text ?? '').toLowerCase().includes(needle));
}

/** "1 player", "3 players". */
export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Whether a player won: 'Nobody' is the no-winner sentinel, not a player. */
export function hasWinner(game: AdminGameDoc) {
  return !!game.winner && game.winner !== 'Nobody';
}
