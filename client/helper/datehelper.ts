// Relative timestamps ("created 5 minutes ago", the chat's "5m") and the full date their
// hover text shows. `formatDate` was a global Blaze helper until P8 step 4.
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

// Under a second, so no entry above it qualifies: `numeric: 'auto'` renders it as "now".
const SECONDS: [Intl.RelativeTimeFormatUnit, number] = ['second', 1];

export function formatDate(timestamp: number): string {
  const seconds = (timestamp - Date.now()) / 1000;
  const [unit, secondsPerUnit] =
    UNITS.find(([, perUnit]) => Math.abs(seconds) >= perUnit) ?? SECONDS;
  return rtf.format(Math.round(seconds / secondsPerUnit), unit);
}

const SHORT_UNITS: [string, number][] = [
  ['y', 31536000],
  ['mo', 2592000],
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
];

/** The chat's compact age: `now`, `5m`, `3h`, `2d`, `7mo`, `1y`. */
export function formatAge(timestamp: number): string {
  // A client clock a little behind the server's puts a fresh line in the future.
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  const short = SHORT_UNITS.find(([, perUnit]) => seconds >= perUnit);
  // Floored, not rounded as formatDate does, so a line 59½ minutes old never reads "60m".
  return short ? `${Math.floor(seconds / short[1])}${short[0]}` : 'now';
}

/** The exact local date and time a relative stamp stands for, for its hover text. */
export function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
}
