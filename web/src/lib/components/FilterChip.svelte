<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  // A pill-shaped toggle used by the timeline filter bar. `aria-pressed`
  // communicates the on/off state to assistive tech.
  let {
    active = false,
    onclick,
    children
  }: { active?: boolean; onclick?: () => void; children: Snippet } = $props();
</script>

<button
  type="button"
  {onclick}
  aria-pressed={active}
  class={cn(
    'inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors',
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-input bg-card text-foreground hover:bg-accent'
  )}
>
  {@render children()}
</button>
