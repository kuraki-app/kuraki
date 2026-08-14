<script lang="ts" generics="T extends string">
  // One segmented control, replacing four hand-rolled implementations of the
  // same idea: `.seg` in settings/appearance, `.theme` in MobileNav, the density
  // group in LibraryView, and `.chips` on the timeline. They differed in
  // padding, radius, fill and — the part that actually mattered — in whether
  // they told assistive technology anything at all. Two set `aria-pressed`; two
  // rendered a row of anonymous buttons.
  //
  // The group carries `role="group"` and the caller supplies its label, because
  // a set of options with no name is a set of options nobody can navigate.
  import type { Component } from 'svelte';

  /** A lucide glyph. Decorative — the label is the accessible name — so the
   *  props it must accept are the ones this component passes it. */
  type Glyph = Component<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;

  type Option = {
    value: T;
    label: string;
    icon?: Glyph;
  };

  export let options: readonly Option[];
  export let value: T;
  /** Names the group. Required: SettingRow's label is not attached to this. */
  export let label: string;
  /** `fill` stretches segments to equal widths — for the mobile sheet, where
   *  the row is the full width of the screen. */
  export let fill = false;
  /** Hides the text label, leaving the icon. The label still names the button. */
  export let iconOnly = false;

  export let onchange: (value: T) => void = () => {};

  function select(next: T) {
    if (next === value) return;
    value = next;
    onchange(next);
  }
</script>

<div class="seg" class:fill role="group" aria-label={label}>
  {#each options as option (option.value)}
    <button
      type="button"
      class:on={value === option.value}
      aria-pressed={value === option.value}
      aria-label={iconOnly ? option.label : undefined}
      title={iconOnly ? option.label : undefined}
      on:click={() => select(option.value)}
    >
      {#if option.icon}
        <svelte:component this={option.icon} size={14} aria-hidden="true" />
      {/if}
      {#if !iconOnly}{option.label}{/if}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: flex;
    gap: 4px;
  }
  .seg.fill {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
  }
  .seg button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    /* 28px tall was below any reasonable target floor, and the density variant
     * of this control was the worst offender in the app at 36x28. */
    min-height: 34px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    /* --frame-radius so the control takes the register of the page it is on:
     * 8px on a Kura page, 4px in the Vault. It was hardcoded differently in
     * three of the four originals. */
    border-radius: var(--frame-radius, 8px);
    background: var(--card);
    color: var(--text-dim);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .seg button:hover {
    color: var(--foreground);
  }
  @media (pointer: coarse) {
    .seg button {
      min-height: 44px;
      padding: 6px 14px;
    }
  }
  .seg button.on {
    background: var(--accent);
    color: var(--foreground);
    /* --stamp marks the current selection: brand, active nav, selection — which
     * is exactly what app.css reserves it for. */
    border-color: var(--stamp);
  }
</style>
