// Relative timestamps for the game list ("created 5 minutes ago"). A global Blaze helper
// until P8 step 4; the only three call sites were the lists, so it is a plain function now
// and the registration is gone.
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
