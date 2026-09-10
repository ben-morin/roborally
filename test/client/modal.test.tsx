// @vitest-environment jsdom
// The one dialog: modalAlert and modalConfirm queue a request, the Modal component shows it
// in a native <dialog>, and the buttons and keys settle the promise. jsdom has no
// showModal/close, so the two are given here in the shape the component relies on: `open`
// flips, and close() fires `close`.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modalAlert, modalConfirm, settleDialog } from '../../client/helper/modalDialogs.ts';
import { Modal } from '../../client/views/layout/Modal.tsx';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  // Drain anything a test left queued so the next one starts shut.
  for (let i = 0; i < 5; i++) settleDialog(false);
  cleanup();
});

const dialog = () => document.querySelector('dialog')!;
/** Queue a request inside a synchronous act, so the dialog has rendered when it returns. */
function show(request: () => Promise<boolean>) {
  let pending!: Promise<boolean>;
  act(() => {
    pending = request();
  });
  return pending;
}
const ok = () => screen.getByRole('button', { name: 'Ok' });
const cancel = () => screen.queryByRole('button', { name: 'Cancel' });
const pressEnter = () =>
  act(() => {
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
const pressEscape = () =>
  act(() => {
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
  });

describe('Modal', () => {
  it('is shut with nothing to show', () => {
    render(<Modal />);

    expect(dialog().open).toBe(false);
    expect(dialog()).toBeEmptyDOMElement();
  });

  describe('modalAlert', () => {
    it('shows the message with an Ok button only, and resolves true once acknowledged', async () => {
      render(<Modal />);

      const pending = show(() => modalAlert('Too many players.'));

      expect(dialog().open).toBe(true);
      expect(screen.getByText('Too many players.')).toBeVisible();
      expect(cancel()).toBeNull();
      expect(ok()).toHaveFocus();

      await userEvent.click(ok());

      await expect(pending).resolves.toBe(true);
      expect(dialog().open).toBe(false);
    });

    it('accepts Enter as acknowledgement', async () => {
      render(<Modal />);
      const pending = show(() => modalAlert('boom'));

      pressEnter();

      await expect(pending).resolves.toBe(true);
    });

    it('resolves true on Escape too: an alert has nothing to refuse', async () => {
      render(<Modal />);
      const pending = show(() => modalAlert('boom'));

      pressEscape();

      await expect(pending).resolves.toBe(true);
    });

    it('keeps the previous message when called with no text', async () => {
      render(<Modal />);
      const first = show(() => modalAlert('Remembered.'));
      await userEvent.click(ok());
      await first;

      show(() => modalAlert());

      expect(screen.getByText('Remembered.')).toBeVisible();
    });
  });

  describe('modalConfirm', () => {
    it('offers Cancel and Ok, and resolves with the choice', async () => {
      render(<Modal />);

      const pending = show(() => modalConfirm('Remove this game?'));

      expect(cancel()).toBeVisible();
      await userEvent.click(ok());

      await expect(pending).resolves.toBe(true);
    });

    it('resolves false from the Cancel button', async () => {
      render(<Modal />);
      const pending = show(() => modalConfirm('Sure?'));

      await userEvent.click(cancel()!);

      await expect(pending).resolves.toBe(false);
    });

    it('resolves false on Escape and true on Enter', async () => {
      render(<Modal />);
      const refused = show(() => modalConfirm('Sure?'));
      pressEscape();
      await expect(refused).resolves.toBe(false);

      const accepted = show(() => modalConfirm('Sure?'));
      pressEnter();
      await expect(accepted).resolves.toBe(true);
    });
  });

  it('shows queued requests one after another', async () => {
    render(<Modal />);
    const first = show(() => modalAlert('First'));
    const second = show(() => modalConfirm('Second'));
    expect(screen.getByText('First')).toBeVisible();
    expect(screen.queryByText('Second')).toBeNull();

    await userEvent.click(ok());
    await expect(first).resolves.toBe(true);

    expect(screen.getByText('Second')).toBeVisible();
    expect(cancel()).toBeVisible();
    await userEvent.click(cancel()!);
    await expect(second).resolves.toBe(false);
    expect(dialog().open).toBe(false);
  });
});
