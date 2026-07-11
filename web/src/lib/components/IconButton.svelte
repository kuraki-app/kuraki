<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';

  // Square, icon-only button with a required accessible label. Thin wrapper over
  // the shadcn Button so every icon control stays consistent and labelled.
  let {
    label,
    variant = 'outline',
    onclick,
    disabled = false,
    children
  }: {
    label: string;
    variant?: 'outline' | 'ghost' | 'secondary' | 'default';
    onclick?: () => void;
    disabled?: boolean;
    children: Snippet;
  } = $props();
</script>

<Button {variant} size="icon" aria-label={label} title={label} {onclick} {disabled}>
  {@render children()}
</Button>
