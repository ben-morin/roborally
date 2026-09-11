// @vitest-environment jsdom
// One card, in each of the shapes client/lib/cardUI.ts hands out. The class names are
// asserted by name because the stylesheet and the browser journey both select on them.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Card } from '../../client/views/cards/Card.tsx';
import { addUIData } from '../../client/lib/cardUI.ts';
import { CardLogic } from '../../both/cardlogic.ts';

const E = CardLogic.EMPTY;
const TURN_RIGHT = 6;
const STEP_FORWARD = 48;

afterEach(cleanup);

describe('Card', () => {
  it('draws an empty register slot, with the cursor when it is the selected one', () => {
    const [slot] = addUIData([E], false, 0, true, 8);

    const { container, rerender } = render(<Card card={slot} />);
    expect(container.firstChild).toHaveClass('gamecard', 'empty');
    expect(container.firstChild).not.toHaveClass('selected');

    rerender(<Card card={slot} selected />);
    expect(container.firstChild).toHaveClass('selected');
    expect(screen.getByLabelText('Register 1, empty')).toBeInTheDocument();
  });

  it('shows the seconds left in the cursor slot, and nothing once they are gone', () => {
    const [slot] = addUIData([E], false, 0, true, 8);

    const { container, rerender } = render(<Card card={slot} selected timeLeft={12} />);
    expect(container.firstChild).toHaveTextContent('12');

    rerender(<Card card={slot} selected timeLeft={0} />);
    expect(container.firstChild).toBeEmptyDOMElement();

    // Only the cursor slot carries the digits.
    rerender(<Card card={slot} selected={false} timeLeft={12} />);
    expect(container.firstChild).toBeEmptyDOMElement();
  });

  it('draws a covered card and a slot lost to damage', () => {
    const [covered, lost] = addUIData([CardLogic.COVERED, CardLogic.DAMAGE], true, 0, false, 8);

    const { container } = render(
      <>
        <Card card={covered} />
        <Card card={lost} />
      </>
    );

    expect(container.children[0]).toHaveClass('gamecard', 'covered');
    expect(container.children[1]).toHaveClass('gamecard', 'damage');
  });

  it('draws a real card with its type, its state classes and its priority', () => {
    const [card] = addUIData([TURN_RIGHT], true, 0, false, 8, new Set([TURN_RIGHT]));

    const { container } = render(<Card card={card} />);

    expect(container.firstChild).toHaveClass('gamecard', 'turn-right', 'available', 'chosen');
    expect(container.querySelector('.priority')).toHaveTextContent('70');
    expect(container.querySelector('img.locked')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Turn right, priority 70, in a register')).toBeInTheDocument();
  });

  // The printed digits shrink with the card, so the number is also on the native tooltip —
  // the same one the option-card pills use. Only a face-up card has one.
  it('names the priority in a tooltip, and only where there is a priority', () => {
    const [card] = addUIData([TURN_RIGHT], true, 0, false, 8);
    const [covered, lost] = addUIData([CardLogic.COVERED, CardLogic.DAMAGE], true, 0, false, 8);
    const [slot] = addUIData([E], false, 0, true, 8);

    const { container } = render(
      <>
        <Card card={card} />
        <Card card={covered} />
        <Card card={lost} />
        <Card card={slot} />
      </>
    );

    expect(container.children[0]).toHaveAttribute('title', 'Priority: 70');
    expect(container.children[1]).not.toHaveAttribute('title');
    expect(container.children[2]).not.toHaveAttribute('title');
    expect(container.children[3]).not.toHaveAttribute('title');
  });

  it('lays the damage token over a locked register', () => {
    // lockedCnt 1: the fifth slot is locked.
    const row = addUIData([E, E, E, E, STEP_FORWARD], false, 1, true, 8);

    const { container } = render(<Card card={row[4]} />);

    expect(container.firstChild).toHaveClass('played', 'locked');
    expect(container.querySelector('img.locked')).toHaveAttribute('src', '/damage-token.png');
    expect(container.querySelector('img.locked')).toHaveAttribute('draggable', 'false');
    expect(
      screen.getByLabelText('Register 5, Step forward, priority 490, locked')
    ).toBeInTheDocument();
  });

  it('is a button only when it has a handler, and answers the click and the keyboard', () => {
    const [card] = addUIData([TURN_RIGHT], true, 0, false, 8);
    const onClick = vi.fn();

    const { rerender } = render(<Card card={card} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<Card card={card} onClick={onClick} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('tabindex', '0');

    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: 'a' });

    expect(onClick).toHaveBeenCalledTimes(3);
  });
});
