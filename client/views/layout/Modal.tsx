// The dialog behind modalAlert / modalConfirm, over a native <dialog>. Rendered once, by
// the layout; it shows whatever client/helper/modalDialogs.ts has queued. Escape and the
// Cancel button dismiss, Enter and Ok confirm, and the backdrop is not click-through —
// which is what `showModal()` gives for free.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { currentDialog, settleDialog, subscribeDialogs } from '../../helper/modalDialogs.ts';

const BTN =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-control px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PRIMARY = `${BTN} border-0 bg-brand text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)]`;
const GHOST = `${BTN} border border-white/22 bg-transparent text-white hover:border-white/40 hover:bg-raised`;

export function Modal() {
  const request = useSyncExternalStore(subscribeDialogs, currentDialog, currentDialog);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request && !dialog.open) {
      dialog.showModal();
      okRef.current?.focus();
    } else if (!request && dialog.open) {
      dialog.close();
    }
  }, [request]);

  // Escape. The browser fires `cancel` and would close the element itself; settling first
  // keeps the store and the DOM in step, and the effect above does the closing.
  const onCancel = (event: SyntheticEvent) => {
    event.preventDefault();
    settleDialog(!request?.confirm);
  };
  // Enter anywhere in the dialog confirms, as it did before — not only on the Ok button.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    settleDialog(true);
  };

  return (
    <dialog
      ref={dialogRef}
      className="mx-auto mt-30 w-[480px] max-w-[calc(100%-32px)] rounded-panel border border-line bg-navy-deep p-6 text-white shadow-[0_24px_60px_-24px_rgba(0,0,0,.8)] backdrop:bg-[rgba(12,20,28,.7)]"
      onCancel={onCancel}
      onKeyDown={onKeyDown}
      aria-labelledby="dialog-text"
    >
      {request && (
        <>
          <p id="dialog-text" className="mt-0 mb-5 text-base leading-normal">
            {request.text}
          </p>
          <div className="flex justify-end gap-2">
            {request.confirm && (
              <button type="button" className={GHOST} onClick={() => settleDialog(false)}>
                Cancel
              </button>
            )}
            <button
              ref={okRef}
              type="button"
              className={PRIMARY}
              onClick={() => settleDialog(true)}
            >
              Ok
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
