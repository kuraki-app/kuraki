<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  export let message: string;
  export let retryLabel = 'Try again';
  export let retry: () => void;
  export let busy = false;
</script>

<div class="load-error" role="alert">
  <p>{message}</p>
  <Button variant="outline" size="sm" disabled={busy} onclick={retry} aria-label={retryLabel}>{busy ? 'Retrying…' : 'Try again'}</Button>
</div>

<style>
  .load-error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--destructive-border); border-radius: var(--collection-radius); background: var(--destructive-bg); }
  p { margin: 0; font-size: 14px; color: var(--destructive); overflow-wrap: anywhere; }
</style>
