// The relative timestamps and the full date behind their hover text. formatDate was a global
// Blaze helper until the list became a React component; its tests are the ones it always had.
import { describe, expect, it } from 'vitest';
import { formatAge, formatDate, formatFullDate } from '../../client/helper/datehelper.ts';

describe('formatDate', () => {
  it.each([
    ['30 seconds ago', -30_000, 'second'],
    ['5 minutes ago', -5 * 60_000, 'minute'],
    ['3 hours ago', -3 * 3_600_000, 'hour'],
    ['4 days ago', -4 * 86_400_000, 'day'],
    ['2 months ago', -2 * 2_592_000_000, 'month'],
    ['2 years ago', -2 * 31_536_000_000, 'year'],
  ])('describes %s in %s units', (_label, offset, unit) => {
    const text = formatDate(Date.now() + offset);

    expect(text).toContain(unit);
    expect(text).toMatch(/ago/);
  });

  it('describes a future timestamp as upcoming', () => {
    expect(formatDate(Date.now() + 5 * 60_000)).toMatch(/in /);
  });

  it('uses the "now"-style wording for the current instant', () => {
    // numeric: 'auto' renders 0 seconds as "now" rather than "in 0 seconds".
    expect(formatDate(Date.now())).toBe('now');
  });
});

describe('formatAge', () => {
  it.each([
    ['now', 0],
    ['now', -59_000],
    ['1m', -60_000],
    ['59m', -(59 * 60_000 + 50_000)],
    ['3h', -3 * 3_600_000],
    ['4d', -4 * 86_400_000],
    ['7mo', -7 * 2_592_000_000],
    ['2y', -2 * 31_536_000_000],
  ])('reads %s', (text, offset) => {
    expect(formatAge(Date.now() + offset)).toBe(text);
  });

  it('reads a line from a server clock ahead of this one as new', () => {
    expect(formatAge(Date.now() + 5_000)).toBe('now');
  });
});

describe('formatFullDate', () => {
  it('names the weekday, the year and the time', () => {
    const text = formatFullDate(new Date(2026, 5, 26, 15, 23).getTime());

    expect(text).toContain('2026');
    expect(text).toMatch(/Friday/);
    expect(text).toMatch(/3:23|15:23/);
  });
});
