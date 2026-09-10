// The app's one dialog, as a promise. `modalAlert` and `modalConfirm` keep the signatures
// the twenty call sites have always used; behind them is a small store that the `Modal`
// component in client/views/layout/Modal.tsx renders from. It used to drive a Bootstrap
// modal that lived in the Blaze layout's markup.

export interface DialogRequest {
  text: string;
  // A confirm offers Cancel and resolves false on dismissal; an alert only acknowledges.
  confirm: boolean;
  resolve: (value: boolean) => void;
}

const queue: DialogRequest[] = [];
const listeners = new Set<() => void>();
// A call with no text re-shows the last message, as the old markup-reusing version did.
let lastText = '';

function emit() {
  listeners.forEach((listener) => listener());
}

function open(text: string | undefined, confirm: boolean) {
  if (text) lastText = text;
  return new Promise<boolean>((resolve) => {
    queue.push({ text: lastText, confirm, resolve });
    emit();
  });
}

/** Show `bodyText` with an Ok button; resolves true once acknowledged. */
export function modalAlert(bodyText?: string) {
  return open(bodyText, false);
}

/** Show `bodyText` with Cancel and Ok; resolves with the choice. */
export function modalConfirm(bodyText?: string) {
  return open(bodyText, true);
}

// --- the component's side ---

/** The request on screen, or null. Requests queue: the next shows when this one settles. */
export function currentDialog(): DialogRequest | null {
  return queue[0] ?? null;
}

export function subscribeDialogs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Close the dialog on screen with `value`. A no-op when nothing is open. */
export function settleDialog(value: boolean) {
  const request = queue.shift();
  if (!request) return;
  emit();
  request.resolve(value);
}
