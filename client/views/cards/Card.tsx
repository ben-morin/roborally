// One card: a hand card, a register slot, or a card in somebody's small hand. Replaces
// the `card` template. The property bag is what client/lib/cardUI.ts builds, unchanged;
// the class names it carries (`available`, `played`, `chosen`, `locked`, the card type)
// are what the stylesheet draws and what the browser journey selects.
import type { KeyboardEvent } from 'react';
import type { addUIData } from '../../lib/cardUI.ts';

export type UICard = ReturnType<typeof addUIData>[number];

export interface CardProps {
  card: UICard;
  // The cursor: the register slot the next hand click fills. Only an empty slot shows it.
  selected?: boolean;
  // Seconds left on the programming timer, shown inside the cursor slot while it runs.
  timeLeft?: number;
  // Present on the player's own hand and registers only. A card without a handler is
  // somebody else's, and a click on it does nothing — which is what the Blaze handlers
  // had to check for by hand.
  onClick?: () => void;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const SLOT_TIMER =
  'absolute inset-0 flex items-center justify-center font-display text-[22px] font-bold text-teal';

/** 'step-forward-2' → 'Step forward 2', for the accessible name. */
function describe(type: string | undefined) {
  if (!type) return 'Card';
  const words = type.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function Card({ card, selected = false, timeLeft = 0, onClick }: CardProps) {
  const register = card.slot === undefined ? '' : `Register ${card.slot + 1}, `;
  const interactive = onClick
    ? {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onClick();
        },
      }
    : {};

  if (card.type === 'empty') {
    return (
      <div
        className={`gamecard empty ${FOCUS}${selected ? ' selected' : ''}`}
        aria-label={`${register}empty`}
        {...interactive}
      >
        {selected && timeLeft > 0 && <div className={SLOT_TIMER}>{timeLeft}</div>}
      </div>
    );
  }
  if (card.type === 'covered') {
    return <div className="gamecard covered" aria-label={`${register}face down`} />;
  }
  if (card.type === 'dmg') {
    return <div className="gamecard damage" aria-label="Lost to damage" />;
  }

  const name = describe(card.type);
  const detail = [
    card.priority === undefined ? null : `priority ${card.priority}`,
    card.locked ? 'locked' : null,
    card.chosen ? 'in a register' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div
      className={`gamecard ${card.type ?? ''} ${card.class ?? ''} ${FOCUS}`.replace(/\s+/g, ' ')}
      aria-label={`${register}${name}${detail ? `, ${detail}` : ''}`}
      {...interactive}
    >
      {card.priority !== undefined && (
        <div className="priority-wrapper">
          <span className="priority">{card.priority}</span>
        </div>
      )}
      {card.locked && (
        <img className="locked" src="/damage-token.png" width="50%" alt="" draggable={false} />
      )}
    </div>
  );
}
