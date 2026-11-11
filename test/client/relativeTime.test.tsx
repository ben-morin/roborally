// @vitest-environment jsdom
// A relative time with the exact date as its hover text, kept current by one shared timer.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatFullDate } from '../../client/helper/datehelper.ts';
import { RelativeTime, TICK_MS } from '../../client/views/layout/RelativeTime.tsx';

const NOW = new Date(2026, 10, 10, 10, 40).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RelativeTime', () => {
  it('reads the long form by default and the chat form when short', () => {
    render(
      <>
        <RelativeTime timestamp={NOW - 5 * 60_000} />
        <RelativeTime timestamp={NOW - 5 * 60_000} short />
      </>
    );

    expect(screen.getByText('5 minutes ago')).toBeVisible();
    expect(screen.getByText('5m')).toBeVisible();
  });

  it('carries the exact date as its hover text and its machine-readable date', () => {
    const at = NOW - 3_600_000;

    render(<RelativeTime timestamp={at} short />);

    const stamp = screen.getByText('1h');
    expect(stamp.tagName).toBe('TIME');
    expect(stamp).toHaveAttribute('title', formatFullDate(at));
    expect(stamp).toHaveAttribute('dateTime', new Date(at).toISOString());
  });

  it('moves on while the page stays open', () => {
    render(<RelativeTime timestamp={NOW} short />);
    expect(screen.getByText('now')).toBeVisible();

    act(() => vi.advanceTimersByTime(2 * TICK_MS));

    expect(screen.getByText('1m')).toBeVisible();
  });

  it('runs one timer for every stamp, and none once they are gone', () => {
    const { unmount } = render(
      <>
        <RelativeTime timestamp={NOW} />
        <RelativeTime timestamp={NOW} />
        <RelativeTime timestamp={NOW} />
      </>
    );

    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
