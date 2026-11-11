// @vitest-environment jsdom
// The ranking: one list at a time, picked by tab; the first three on a podium with their
// medals, and the rest in rows under it. Both lists share one collection, told apart by `type`.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ranking } from '../../client/views/ranking/Ranking.tsx';
import { Highscores } from '../../collections/highscores.ts';
import { resetFakeCollections } from '../setup.js';

beforeEach(() => resetFakeCollections());
afterEach(cleanup);

/** One list's rows, best first. Inserted worst first, so the screen has to sort them. */
async function list(type: string, ...rows: [string, number][]) {
  for (const [i, [name, value]] of [...rows.entries()].reverse()) {
    await Highscores.insertAsync({ type, name, value, rank: i + 1 });
  }
}

/** An element's text, one word group per text node: "ann 9 wins 1". */
function words(element: Element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) parts.push(text);
  }
  return parts.join(' ');
}

const tab = (name: string) => screen.getByRole('tab', { name });
/** The podium's places, then the rows under it, each list read item by item. */
const lists = () =>
  screen.getAllByRole('list').map((ol) => within(ol).getAllByRole('listitem').map(words));

describe('Ranking', () => {
  it('opens on most wins: the first three on the podium, the rest in rows', async () => {
    await list('mostWon', ['ann', 9], ['bob', 5], ['cal', 3], ['dee', 2], ['eve', 1]);
    await list('mostPlayed', ['zed', 20]);

    render(<Ranking />);

    expect(tab('Most wins')).toHaveAttribute('aria-selected', 'true');
    expect(lists()).toEqual([
      ['ann 9 wins 1', 'bob 5 wins 2', 'cal 3 wins 3'],
      ['4 dee 2 wins', '5 eve 1 win'],
    ]);
    expect(screen.queryByText('zed')).not.toBeInTheDocument();
  });

  it('gives the first three their medal robots and the winner a crown', async () => {
    await list('mostWon', ['ann', 9], ['bob', 5], ['cal', 3]);

    const { container } = render(<Ranking />);

    const robots = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(robots).toEqual(['/robots/robot_0.png', '/robots/robot_4.png', '/robots/robot_7.png']);
    expect(container.querySelectorAll('[data-icon="crown"]')).toHaveLength(1);
  });

  it('gives a tie one rank and one medal', async () => {
    await list('mostWon', ['ann', 5], ['bob', 5], ['cal', 3], ['dee', 3], ['eve', 1]);

    const { container } = render(<Ranking />);

    expect(lists()).toEqual([
      ['ann 5 wins 1', 'bob 5 wins 1', 'cal 3 wins 3'],
      ['3 dee 3 wins', '5 eve 1 win'],
    ]);
    const robots = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(robots).toEqual(['/robots/robot_0.png', '/robots/robot_0.png', '/robots/robot_7.png']);
    expect(container.querySelectorAll('[data-icon="crown"]')).toHaveLength(2);
    // The tied winners stand alike, the second one on a winner's robot size too.
    const sizes = [...container.querySelectorAll('img')].map((img) => img.getAttribute('width'));
    expect(sizes).toEqual(['120', '120', '88']);
  });

  it("fills each row to its share of the leader's count", async () => {
    await list('mostWon', ['ann', 8], ['bob', 6], ['cal', 4], ['dee', 2]);

    render(<Ranking />);

    // `!`s: the name sits in a row, and every row has one share bar, hidden from a screen reader.
    const bar = screen.getByText('dee').closest('li')!.querySelector('[aria-hidden="true"]')!;
    expect(bar).toHaveStyle({ width: '25%' });
  });

  it('switches lists by tab, and the arrows move between the tabs', async () => {
    await list('mostWon', ['ann', 9]);
    await list('mostPlayed', ['zed', 20]);
    render(<Ranking />);

    fireEvent.click(tab('Most games'));

    expect(tab('Most games')).toHaveAttribute('aria-selected', 'true');
    expect(lists()).toEqual([['zed 20 games 1']]);

    fireEvent.keyDown(tab('Most games'), { key: 'ArrowRight' });

    expect(tab('Most wins')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Most wins')).toHaveFocus();
    expect(lists()).toEqual([['ann 9 wins 1']]);
  });

  it('leaves the empty steps bare when fewer than three have played', async () => {
    await list('mostWon', ['ann', 2]);

    render(<Ranking />);

    expect(lists()).toEqual([['ann 2 wins 1']]);
  });

  it('says so when a list is empty', () => {
    render(<Ranking />);

    expect(screen.getByText('Nobody has won a game yet.')).toBeVisible();
    fireEvent.click(tab('Most games'));
    expect(screen.getByText('Nobody has played a game yet.')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
