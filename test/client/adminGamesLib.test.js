// The games manager's row logic: a game's state, the counts, the filter and the wording.
import { describe, expect, it } from 'vitest';
import {
  countByStatus,
  hasWinner,
  matchesGameFilter,
  plural,
  statusOf,
} from '../../client/lib/adminGames.ts';

const CAP = 3;
const game = (fields = {}) => ({
  _id: 'g',
  name: 'Friday Race',
  userId: 'ann',
  author: 'ann',
  submitted: 0,
  started: true,
  gamePhase: 'program',
  playPhase: 'waiting',
  programRound: 1,
  boardName: 'checkmate',
  min_player: 1,
  max_player: 8,
  ...fields,
});

describe('statusOf', () => {
  it('reads a lobby as waiting', () => {
    expect(statusOf(game({ started: false, gamePhase: 'waiting' }), CAP)).toBe('waiting');
  });

  it('reads a running game as live, failed replays below the cap included', () => {
    expect(statusOf(game(), CAP)).toBe('live');
    expect(statusOf(game({ resumeAttempts: 2 }), CAP)).toBe('live');
  });

  it('reads a running game at the cap as parked', () => {
    expect(statusOf(game({ resumeAttempts: 3 }), CAP)).toBe('parked');
    expect(statusOf(game({ resumeAttempts: 4 }), CAP)).toBe('parked');
  });

  it("reads any game with a winner as ended, 'Nobody' included", () => {
    expect(statusOf(game({ winner: 'ann', gamePhase: 'game ended' }), CAP)).toBe('ended');
    expect(statusOf(game({ winner: 'Nobody', resumeAttempts: 3 }), CAP)).toBe('ended');
  });
});

describe('countByStatus', () => {
  it('counts every state, empty ones as zero', () => {
    const games = [game(), game({ winner: 'Nobody' }), game({ winner: 'ann' })];
    expect(countByStatus(games, CAP)).toEqual({ waiting: 0, live: 1, parked: 0, ended: 2 });
  });
});

describe('matchesGameFilter', () => {
  const players = [{ _id: 'p', gameId: 'g', userId: 'bob', name: 'Bobby' }];

  it('matches everything when empty or blank', () => {
    expect(matchesGameFilter(game(), [], '')).toBe(true);
    expect(matchesGameFilter(game(), [], '  ')).toBe(true);
  });

  it('matches the name, the board, the owner and a player, ignoring case', () => {
    expect(matchesGameFilter(game(), players, 'friday')).toBe(true);
    expect(matchesGameFilter(game(), players, 'CHECK')).toBe(true);
    expect(matchesGameFilter(game(), players, 'Ann')).toBe(true);
    expect(matchesGameFilter(game(), players, 'bobby')).toBe(true);
  });

  it('matches nothing else', () => {
    expect(matchesGameFilter(game(), players, 'carl')).toBe(false);
  });

  it("matches the owner's and a player's current name after a rename", () => {
    const nameOf = (userId) => ({ ann: 'Annabel', bob: 'Robert' })[userId];

    expect(matchesGameFilter(game(), players, 'annabel', nameOf)).toBe(true);
    expect(matchesGameFilter(game(), players, 'robert', nameOf)).toBe(true);
    expect(matchesGameFilter(game(), players, 'robert')).toBe(false);
  });
});

describe('the wording', () => {
  it('counts in the singular and the plural', () => {
    expect(plural(1, 'player')).toBe('1 player');
    expect(plural(0, 'player')).toBe('0 players');
    expect(plural(3, 'game')).toBe('3 games');
  });

  it("counts no winner for the 'Nobody' sentinel or none at all", () => {
    expect(hasWinner(game({ winner: 'Nobody' }))).toBe(false);
    expect(hasWinner(game())).toBe(false);
    expect(hasWinner(game({ winner: 'ann' }))).toBe(true);
  });
});
