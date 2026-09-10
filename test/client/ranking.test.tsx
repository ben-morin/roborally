// @vitest-environment jsdom
// The two highscore lists. They share one collection and are told apart by `type`, which
// is the only thing this component has to get right.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ranking } from '../../client/views/ranking/Ranking.tsx';
import { Highscores } from '../../collections/highscores.ts';
import { resetFakeCollections } from '../setup.js';

beforeEach(() => resetFakeCollections());
afterEach(cleanup);

/** The rows rendered under each heading, in order — one group per heading. */
function lists(container: HTMLElement) {
  const groups: string[][] = [];
  for (const child of container.querySelectorAll('.highscores > *')) {
    if (child.tagName === 'H2') groups.push([]);
    else if (child.tagName === 'P') groups[groups.length - 1].push(child.textContent ?? '');
  }
  return groups;
}

describe('Ranking', () => {
  it('splits the two lists and numbers each place', async () => {
    await Highscores.insertAsync({ type: 'mostWon', name: 'ann', value: 2, rank: 1 });
    await Highscores.insertAsync({ type: 'mostPlayed', name: 'bob', value: 9, rank: 1 });
    await Highscores.insertAsync({ type: 'mostPlayed', name: 'cal', value: 4, rank: 2 });

    const { container } = render(<Ranking />);

    expect(lists(container)).toEqual([['1. bob (9)', '2. cal (4)'], ['1. ann (2)']]);
  });

  it('renders both headings with nothing under them when no game has been played', () => {
    const { container } = render(<Ranking />);

    expect(screen.getByRole('heading', { name: 'Most games played' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Most games won' })).toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});
