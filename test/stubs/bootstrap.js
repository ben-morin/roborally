// Resolves the `bootstrap` npm package for client/helper/modalDialogs.js, which is
// imported (for modalAlert/modalConfirm) by most view modules. Bootstrap's real bundle
// touches `document` while it loads and would drag a full widget implementation into a
// helper-level test; the dialogs themselves are driven by DOM events, so tests that care
// about them stub modalAlert/modalConfirm directly instead.
const instances = new WeakMap();

export class Modal {
  constructor(element) {
    this.element = element;
    this.shown = false;
  }

  static getOrCreateInstance(element) {
    if (!instances.has(element)) instances.set(element, new Modal(element));
    return instances.get(element);
  }

  show() {
    this.shown = true;
  }

  hide() {
    this.shown = false;
    this.element?.dispatchEvent?.(new Event('hidden.bs.modal'));
  }
}

export default { Modal };
