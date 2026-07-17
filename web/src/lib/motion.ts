import { tick } from 'svelte';
import type { Asset } from '$lib/types';

/** The single shared view-transition-name. Only ever one element at a time. */
export const MORPH_NAME = 'kuraki-morph';

/**
 * True when `Viewer` renders the morph-tagged `<img>` for `asset`.
 *
 * `Viewer`'s image branch keys off this function, so the rule cannot drift: a
 * video renders `<video>` and a non-web-viewable original renders the "preview
 * unavailable" panel, and neither carries `MORPH_NAME`.
 */
export function viewerShowsImage(asset: Pick<Asset, 'web_viewable' | 'media_type'>): boolean {
  return asset.web_viewable && asset.media_type === 'image';
}

/**
 * True when *both* ends of the morph render a tagged `<img>` — the viewer (see
 * `viewerShowsImage`) and the grid tile, which only renders an `<img>` when the
 * asset has a thumbnail.
 *
 * Tag a tile only when this holds. A transition group that gets just one of its
 * two snapshots is not a no-op: the UA animates the lone snapshot on its own —
 * an old-only group fades the stale thumbnail out from the tile's position, and
 * it is painted in the `::view-transition` overlay, which sits above *all* page
 * content including the fixed viewer. That is a ghost over the viewer, not a
 * missing morph.
 */
export function canMorph(
  asset: Pick<Asset, 'web_viewable' | 'media_type' | 'thumbnail_url'>
): boolean {
  return viewerShowsImage(asset) && !!asset.thumbnail_url;
}

/**
 * True when the user has asked for reduced motion.
 *
 * Svelte's `fly`/`fade` transitions are JS-driven — they animate by directly
 * setting styles on each frame, not by triggering a CSS `transition` or
 * `animation` — so the global `transition-duration: 0.001ms !important` rule
 * in app.css (which only targets CSS-driven animations) does not cover them.
 * Any component using a JS transition must check this itself.
 *
 * Guarded for `typeof window` so it is safe to call during SSR/prerender,
 * even though this app is a SPA that normally never hits that path.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

type ViewTransition = { ready: Promise<void>; finished: Promise<void> };

/**
 * Run `update` inside a view transition so the element tagged with `MORPH_NAME`
 * morphs between its old and new position.
 *
 * Falls back to applying `update` directly when the browser lacks the API or
 * the user asked for reduced motion. The CSS rule in app.css is the second
 * belt: this gate stops the transition from ever starting.
 *
 * `update` must be cheap and synchronous in spirit: rendering is suppressed
 * from the moment the transition starts until this callback resolves, so any
 * network round-trip inside it stalls the page and can trip the browser's
 * transition timeout. Resolve data *before* calling `morph`.
 *
 * Resolves once the animation settles (or immediately on the fallback path), and
 * never rejects — callers can always clear their state in a plain `await`.
 */
export async function morph(update: () => void | Promise<void>): Promise<void> {
  const start =
    typeof document === 'undefined'
      ? undefined
      : (
          document as Document & {
            startViewTransition?: (cb: () => Promise<void>) => ViewTransition;
          }
        ).startViewTransition;

  if (!start || prefersReducedMotion()) {
    try {
      await update();
    } catch (err) {
      // Same contract as the transition path below: `update` throwing must not
      // propagate past `morph`, or the caller's cleanup (e.g. clearing
      // `morphId`) never runs and the grid is stuck holding the name.
      console.error('kuraki: view transition update failed — the DOM was not updated', err);
    }
    return;
  }

  const transition = start.call(document, async () => {
    await update();
    // The browser snapshots the new state as soon as this callback resolves,
    // so Svelte must have flushed the DOM before we return.
    await tick();
  });

  // `ready` and `finished` reject for *different* reasons, so both are observed
  // — but not independently logged, because their rejections overlap: when
  // `update` throws, both `ready` *and* `finished` reject for that one cause,
  // and logging each separately would print a misleading "duplicate name"
  // warning right next to the accurate update-failure error. `finished` is the
  // authoritative signal for that case (it rejects *only* when `update` threw),
  // so it takes priority; `ready` is only worth warning about on its own when
  // `finished` did not also reject.
  //
  // Settled together (not `ready` fire-and-forget + `finished` awaited
  // separately) specifically so the `finished` outcome is known before deciding
  // whether `ready`'s rejection is worth a separate warning. This adds no
  // extra wait over the old code: `finished` was already awaited unconditionally,
  // and `ready` always settles no later than `finished`.
  const [readyResult, finishedResult] = await Promise.allSettled([
    transition.ready,
    transition.finished,
  ]);

  if (finishedResult.status === 'rejected') {
    // The update callback itself rejected — the DOM update never happened and,
    // for the open path, the viewer silently failed to open. Log it; swallowing
    // this is how that stays invisible. `ready` rejecting alongside this is a
    // side effect of the same cause, not a separate signal.
    console.error(
      'kuraki: view transition update failed — the DOM was not updated',
      finishedResult.reason
    );
  } else if (readyResult.status === 'rejected') {
    // `finished` fulfilled, so the DOM update itself succeeded — this is a pure
    // skip/abort, not an update failure. Two known causes land here and this
    // API cannot reliably tell them apart: two elements holding
    // view-transition-name "kuraki-morph" at the same snapshot (the failure
    // this design exists to avoid), or a transition superseded by a newer one
    // (e.g. rapid consecutive clicks, which is normal and harmless). Worded as
    // "likely" rather than asserted, since the ambiguity is real.
    console.warn(
      `kuraki: view transition skipped or aborted — the morph did not run. Likely either two elements held view-transition-name "${MORPH_NAME}" at the same snapshot, or this transition was superseded by a newer one before it started.`,
      readyResult.reason
    );
  }
}
