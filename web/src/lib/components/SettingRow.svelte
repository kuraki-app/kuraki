<script lang="ts">
  import { Label } from '$lib/components/ui/label';

  export let label: string;
  export let description = '';
  export let status: 'applied' | 'pending_restart' | 'pinned' | 'none' = 'none';
  export let envVar = '';
  export let disabled = false;
  // A unique id for the Label/control pairing; callers pass the same value
  // as the control's own id (e.g. <Input id={id} ...>).
  export let id: string;
</script>

<div class="row" class:disabled>
  <div class="text">
    <Label for={id}>{label}</Label>
    {#if description}<p class="desc">{description}</p>{/if}
    {#if status === 'applied'}
      <p class="status ok">✓ applied</p>
    {:else if status === 'pending_restart'}
      <p class="status warn">⚠ saved — takes effect after restart</p>
    {:else if status === 'pinned'}
      <p class="status pinned">🔒 set by environment{#if envVar} · <code>{envVar}</code>{/if}</p>
    {/if}
  </div>
  <div class="control">
    <slot />
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: calc(var(--space-step) * 3);
    padding: calc(var(--space-step) * 2) 0;
    border-bottom: 1px solid var(--frame-border-color, var(--border));
  }
  .row:last-child {
    border-bottom: 0;
  }
  .text {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .desc {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.5;
  }
  .status {
    margin: 2px 0 0;
    font-size: 12px;
  }
  .status.ok {
    color: var(--ok);
  }
  .status.warn {
    color: var(--warn-text);
  }
  .status.pinned {
    color: var(--muted-foreground);
  }
  .status.pinned code {
    font-family: var(--font-mono);
  }
  .control {
    display: flex;
    align-items: center;
    flex: none;
  }
  .row.disabled .text {
    opacity: 0.7;
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 1fr;
      gap: var(--space-step);
    }
  }
</style>
