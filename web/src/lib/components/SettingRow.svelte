<script lang="ts">
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';

  export let label: string;
  export let description = '';
  export let status: 'applied' | 'pending_restart' | 'pinned' | 'none' = 'none';
  export let envVar = '';
  export let disabled = false;
  // A unique id for the Label/control pairing; callers pass the same value
  // as the control's own id (e.g. <Input id={id} ...>).
  export let id: string;
  /** What sits in the control slot, which decides how the label attaches:
   *
   *  - 'control' (default): ONE labelable element carrying `id={id}`.
   *  - 'group':   several bare controls that nothing else groups. `for` can
   *               only point at one element, so the slot becomes the group.
   *               NOT for a slot holding a component that already labels its
   *               own group (SegmentedControl does) — two nested groups with
   *               the same name is worse than one, and is what a screen reader
   *               would read out twice.
   *  - 'static':  the row's label is not attached to anything — either the slot
   *               is a rendered value rather than a control, or the slot labels
   *               itself. A `for` in either case can never resolve.
   *
   *  This distinction is not cosmetic: every caller but one used to render a
   *  `<label for>` that matched no element in the document, so clicking the
   *  label did nothing and assistive technology announced an unlabelled
   *  control. `e2e/a11y.spec.ts` now fails on any dangling `label[for]`. */
  export let kind: 'control' | 'group' | 'static' = 'control';

  $: labelId = `${id}-label`;
</script>

<div class="row" class:disabled>
  <div class="text">
    {#if kind === 'control'}
      <Label for={id}>{label}</Label>
    {:else}
      <Label id={labelId}>{label}</Label>
    {/if}
    {#if description}<p class="desc">{description}</p>{/if}
    <!-- These three were hand-rolled coloured paragraphs while `ui/badge` sat in
         the tree with zero consumers. A status pill is precisely what a badge
         is, and the shadcn variants already carry the semantic colours. -->
    {#if status === 'applied'}
      <p class="status"><Badge variant="secondary">✓ applied</Badge></p>
    {:else if status === 'pending_restart'}
      <p class="status"><Badge variant="outline">⚠ saved — takes effect after restart</Badge></p>
    {:else if status === 'pinned'}
      <p class="status">
        <Badge variant="ghost">🔒 set by environment{#if envVar} · <code>{envVar}</code>{/if}</Badge>
      </p>
    {/if}
  </div>
  <div
    class="control"
    role={kind === 'group' ? 'group' : undefined}
    aria-labelledby={kind === 'group' ? labelId : undefined}
  >
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
  /* The env var name inside the pinned badge. `.status.pinned` no longer
   * exists — the variant lives on the Badge — so this hangs off .status. */
  .status code {
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
