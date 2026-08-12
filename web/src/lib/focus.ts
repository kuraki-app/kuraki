/**
 * Focus management for the two hand-rolled dialogs — the media viewer and the
 * album photo picker.
 *
 * Why an action rather than moving both to `ui/dialog`: the viewer is the morph
 * target for the native View Transitions grid→viewer animation, and it owns its
 * own full-screen layout, backdrop and keyboard handling. Wrapping it in bits-ui
 * would put a portal and a managed overlay between the tile and the element
 * carrying `view-transition-name`, which is the one thing that animation cannot
 * survive. `AlbumPicker` and `ConfirmDialog` use `ui/dialog` and get all of this
 * for free; these two get it from here instead.
 *
 * The defect this closes, as measured in the browser: with the viewer open and
 * seven tabbable controls inside it, `document.activeElement` was still the grid
 * tile BEHIND the overlay. So focus never entered the dialog, Tab walked out of
 * it into the hidden grid, and "restore focus on close" passed vacuously —
 * focus returned to the tile only because it had never left.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // offsetParent is null for anything display:none or inside it. A control the
    // eye cannot find should not be in the tab order either.
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/**
 * trapFocus moves focus into the element, keeps Tab inside it, and returns focus
 * where it came from on teardown.
 *
 * Use it on the element carrying `role="dialog"`.
 */
export function trapFocus(node: HTMLElement) {
  // Captured before focus moves. This is the grid tile the viewer was opened
  // from, and it is where a keyboard user expects to be put back.
  const returnTo = document.activeElement as HTMLElement | null;

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const items = focusable(node);
    if (items.length === 0) {
      // Nothing to cycle between, but focus must still not escape.
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !node.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !node.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  // Deferred a frame: the dialog's children mount with it, and on the very first
  // tick `focusable()` can still see an empty subtree.
  const raf = requestAnimationFrame(() => {
    if (node.contains(document.activeElement)) return;
    (focusable(node)[0] ?? node).focus();
  });

  node.addEventListener('keydown', onKeydown);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      node.removeEventListener('keydown', onKeydown);
      // Only restore to something still in the document: the grid virtualizes by
      // section, so the tile that opened the viewer may have been unmounted
      // while it was open. Focusing a detached node silently sends focus to
      // <body>, which is the very thing this exists to prevent.
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    }
  };
}
