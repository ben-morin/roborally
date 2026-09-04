// @vitest-environment jsdom
// Proves the React half of the harness before anything depends on it: @testing-library/react
// renders into jsdom, userEvent drives a click through to a re-render, and the jest-dom
// matchers are wired into vitest's `expect` (D12 — imported here, not from a setup file, so
// the node-only server tests never load react-dom). It is also the automatic-JSX-runtime
// check on the vitest side: nothing below imports the React namespace, so a classic runtime
// would fail here with `React is not defined` exactly as it would in the browser bundle.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>clicked {count} times</button>;
}

describe('React test harness', () => {
  it('renders a component into jsdom', () => {
    render(<Counter />);
    expect(screen.getByRole('button')).toHaveTextContent('clicked 0 times');
  });

  it('re-renders on a userEvent click', async () => {
    render(<Counter />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('clicked 1 times');
  });
});
