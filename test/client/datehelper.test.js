// The game list's relative timestamps. A global Blaze helper until the list became a React
// component; the Intl logic is unchanged, so these are the tests it always had.
import { describe, expect, it } from 'vitest';
import { formatDate } from '../../client/helper/datehelper.ts';

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
