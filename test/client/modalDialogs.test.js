// @vitest-environment jsdom
// modalDialogs wraps a single reused Bootstrap modal in a promise. The interesting part
// is the bookkeeping around it: which button resolves what, that Enter counts as
// confirmation, and that the cancel button hidden by an alert is restored afterwards —
// otherwise the next confirm() would render without its cancel button.
import { beforeEach, describe, expect, it } from 'vitest';
import { modalAlert, modalConfirm } from '../../client/helper/modalDialogs.js';

const MARKUP = `
  <div id="notification-modal" class="modal fade" tabindex="-1">
    <div class="modal-dialog"><div class="modal-content">
      <div class="modal-body"><p></p></div>
      <div class="modal-footer">
        <button type="button" class="btn cancel-button">Cancel</button>
        <button type="button" class="btn confirm-button">Ok</button>
      </div>
    </div></div>
  </div>`;

const body = () => document.querySelector('#notification-modal .modal-body p');
const confirmButton = () => document.querySelector('.confirm-button');
const cancelButton = () => document.querySelector('.cancel-button');
const pressEnter = () =>
  document
    .getElementById('notification-modal')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = MARKUP;
});

describe('modalAlert', () => {
  it('shows the message and resolves once acknowledged', async () => {
    const pending = modalAlert('Too many players.');

    expect(body().textContent).toBe('Too many players.');
    confirmButton().click();

    await expect(pending).resolves.toBe(true);
  });

  it('hides the cancel button while open and restores it afterwards', async () => {
    const pending = modalAlert('boom');
    expect(cancelButton().style.display).toBe('none');

    confirmButton().click();
    await pending;

    expect(cancelButton().style.display).toBe('');
  });

  it('accepts Enter as acknowledgement', async () => {
    const pending = modalAlert('boom');

    pressEnter();

    await expect(pending).resolves.toBe(true);
  });

  it('keeps the previous message when called with no text', async () => {
    const first = modalAlert('first message');
    confirmButton().click();
    await first;

    const second = modalAlert();
    expect(body().textContent).toBe('first message');
    confirmButton().click();
    await second;
  });
});

describe('modalConfirm', () => {
  it('resolves true when confirmed', async () => {
    const pending = modalConfirm('Remove this game?');

    expect(body().textContent).toBe('Remove this game?');
    confirmButton().click();

    await expect(pending).resolves.toBe(true);
  });

  it('resolves false when cancelled', async () => {
    const pending = modalConfirm('Remove this game?');

    cancelButton().click();

    await expect(pending).resolves.toBe(false);
  });

  it('treats Enter as confirmation', async () => {
    const pending = modalConfirm('Remove this game?');

    pressEnter();

    await expect(pending).resolves.toBe(true);
  });

  it('leaves its cancel button visible', async () => {
    const pending = modalConfirm('Remove this game?');
    expect(cancelButton().style.display).not.toBe('none');

    cancelButton().click();
    await pending;
  });

  it('does not leak listeners between dialogs', async () => {
    const first = modalConfirm('first');
    cancelButton().click();
    await expect(first).resolves.toBe(false);

    // If the first dialog's click handler were still attached, this confirm would also
    // resolve the stale promise and could flip `confirmed` on the wrong one.
    const second = modalConfirm('second');
    confirmButton().click();
    await expect(second).resolves.toBe(true);
  });
});
