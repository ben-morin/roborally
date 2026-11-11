// A relative time ("5 minutes ago", or the chat's "5m") whose hover text is the exact date
// and time, and which keeps itself current while the page stays open.
import { useSyncExternalStore } from 'react';
import { formatAge, formatDate, formatFullDate } from '../../helper/datehelper.ts';

// The smallest unit either format shows past the first minute is a minute, so this bounds
// how stale a stamp can read. One timer for every stamp on the page, not one each.
export const TICK_MS = 30_000;

let tick = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    tick++;
    listeners.forEach((notify) => notify());
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const currentTick = () => tick;

export interface RelativeTimeProps {
  timestamp: number;
  short?: boolean;
  className?: string;
}

export function RelativeTime({ timestamp, short = false, className }: RelativeTimeProps) {
  useSyncExternalStore(subscribe, currentTick, currentTick);
  return (
    <time
      className={className}
      dateTime={new Date(timestamp).toISOString()}
      title={formatFullDate(timestamp)}
    >
      {short ? formatAge(timestamp) : formatDate(timestamp)}
    </time>
  );
}
