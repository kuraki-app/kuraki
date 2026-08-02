<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  /**
   * A draggable scroll indicator with a date bubble, for libraries long enough
   * that the browser scrollbar is a hairline representing thousands of photos.
   *
   * It drives `window` scroll rather than a container's: the shell's sidebar is
   * sticky and the page itself is what moves (see routes/+layout.svelte).
   *
   * The label is read from whichever timeline section is under the top of the
   * viewport, not computed from the scroll fraction. The grid virtualizes by
   * section with estimated heights for anything unmaterialized, so a fraction
   * would drift against the real content exactly where the estimates are
   * roughest; asking the DOM which section is actually there cannot drift.
   */

  /** Hide entirely below this much scrollable overflow — a short page has a
   *  perfectly good scrollbar and does not need a second one. */
  const MIN_SCROLLABLE_PX = 2000;
  /** How long the track stays visible after movement stops. */
  const IDLE_MS = 1200;

  let progress = 0; // 0..1
  let label = '';
  let scrollable = 0;
  let trackEl: HTMLDivElement | null = null;
  let dragging = false;
  let visible = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function show(hold = false) {
    visible = true;
    if (idleTimer) clearTimeout(idleTimer);
    // While a finger or pointer is down the thumb must not vanish underneath it.
    if (hold) return;
    idleTimer = setTimeout(() => (visible = false), IDLE_MS);
  }

  function readLabel() {
    // The topmost section whose box still covers the top of the viewport.
    // `data-group` is set by AssetGrid on every section, materialized or not.
    const sections = document.querySelectorAll<HTMLElement>('[data-group]');
    let current = '';
    for (const el of sections) {
      const box = el.getBoundingClientRect();
      if (box.top <= 8 && box.bottom > 8) {
        current = el.querySelector('h2')?.textContent?.trim() ?? '';
        break;
      }
      // Before the first section has scrolled past, use it.
      if (box.top > 8) {
        current = el.querySelector('h2')?.textContent?.trim() ?? current;
        break;
      }
    }
    if (current) label = current;
  }

  function measure() {
    scrollable = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  function onScroll() {
    measure();
    if (!dragging && scrollable > 0) progress = window.scrollY / scrollable;
    readLabel();
    if (scrollable >= MIN_SCROLLABLE_PX) show(dragging);
  }

  function scrubTo(clientY: number) {
    if (!trackEl) return;
    const box = trackEl.getBoundingClientRect();
    const next = Math.min(1, Math.max(0, (clientY - box.top) / Math.max(1, box.height)));
    progress = next;
    // `auto` rather than smooth: this is a direct-manipulation control, and a
    // smooth animation would lag the pointer and fight every further move.
    window.scrollTo({ top: next * scrollable, behavior: 'auto' });
    readLabel();
  }

  function onPointerDown(event: PointerEvent) {
    dragging = true;
    show(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    scrubTo(event.clientY);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    event.preventDefault();
    scrubTo(event.clientY);
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    show();
  }

  // Keyboard control, because a drag handle that only answers to a pointer is
  // not a control at all for anyone navigating by keyboard.
  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === 'PageUp' || event.key === 'PageDown' ? 0.1 : 0.02;
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'PageDown') next = progress + step;
    else if (event.key === 'ArrowUp' || event.key === 'PageUp') next = progress - step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    if (next == null) return;
    event.preventDefault();
    progress = Math.min(1, Math.max(0, next));
    window.scrollTo({ top: progress * scrollable, behavior: 'auto' });
    show();
    readLabel();
  }

  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    measure();
    readLabel();
    // Content height changes as sections materialize and as "Load more" appends,
    // so the track has to re-measure rather than read the height once.
    resizeObserver = new ResizeObserver(() => {
      measure();
      if (!dragging && scrollable > 0) progress = window.scrollY / scrollable;
    });
    resizeObserver.observe(document.documentElement);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (idleTimer) clearTimeout(idleTimer);
  });

  $: enabled = scrollable >= MIN_SCROLLABLE_PX;
</script>

<svelte:window on:scroll={onScroll} on:resize={measure} />

{#if enabled}
  <!-- The track carries the slider role, not the thumb: a press anywhere on it
       jumps to that position, so the whole strip is the control and the thumb
       is just where the value currently sits. -->
  <div
    class="track"
    class:visible={visible || dragging}
    bind:this={trackEl}
    role="slider"
    tabindex="0"
    aria-label="Scroll through the timeline"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(progress * 100)}
    aria-valuetext={label || undefined}
    aria-orientation="vertical"
    on:keydown={onKeyDown}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
  >
    <div class="thumb" style:top="{progress * 100}%"></div>
    {#if label && (dragging || visible)}
      <div class="bubble" style:top="{progress * 100}%">{label}</div>
    {/if}
  </div>
{/if}

<style>
  .track {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 28px;
    z-index: 30;
    touch-action: none;
    opacity: 0;
    transition: opacity 180ms var(--e-kura, ease);
    /* Invisible and inert until the page is actually long enough to need it,
     * so it never sits over content it is not helping with. */
    pointer-events: none;
  }
  .track.visible {
    opacity: 1;
    pointer-events: auto;
  }
  .thumb {
    position: absolute;
    right: 6px;
    width: 16px;
    height: 44px;
    margin-top: -22px;
    border-radius: 999px;
    background: var(--card);
    border: 1px solid var(--border);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.16);
    cursor: grab;
  }
  .thumb:active {
    cursor: grabbing;
  }
  .track:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .bubble {
    position: absolute;
    right: 30px;
    transform: translateY(-50%);
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--card);
    border: 1px solid var(--border);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.18);
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    color: var(--foreground);
    pointer-events: none;
  }
  /* The mobile tab bar owns the bottom edge of small viewports. */
  @media (max-width: 820px) {
    .track {
      bottom: calc(70px + env(safe-area-inset-bottom, 0));
    }
  }
</style>
