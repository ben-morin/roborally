// A game's state as a pill, in the user list's pill shape. Parked is the one that needs the
// admin, so it alone is the warning colour; a lobby is open, so it is outlined teal.
import { STATUS_LABELS } from '../../lib/adminGames.ts';
import type { GameStatus } from '../../lib/adminGames.ts';

const PILL =
  'inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-bold tracking-[.06em] whitespace-nowrap uppercase';
const STATUS_PILL: Record<GameStatus, string> = {
  waiting: `${PILL} border border-teal text-teal`,
  live: `${PILL} bg-teal text-navy`,
  parked: `${PILL} bg-warning text-white`,
  ended: `${PILL} border border-line text-muted`,
};

export function StatusPill({ status }: { status: GameStatus }) {
  return <span className={STATUS_PILL[status]}>{STATUS_LABELS[status]}</span>;
}
