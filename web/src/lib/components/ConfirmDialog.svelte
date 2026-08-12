<script lang="ts">
  // One confirmation dialog for the whole app, replacing native `confirm()`.
  //
  // Native confirm() is not stylable, not themable, blocks the main thread, is
  // suppressed outright by some browsers in cross-origin frames, and cannot say
  // which of "Delete" and "Delete forever" it means beyond a single sentence of
  // plain text. It is used here for the actions that cannot be undone, so it is
  // worth the user being able to read what they are agreeing to.
  //
  // Built on ui/dialog (bits-ui), which brings the focus trap, focus restore,
  // Escape handling and backdrop that the hand-rolled modals in this codebase
  // each re-implement or omit.
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';

  export let open = false;
  export let title: string;
  export let body = '';
  export let confirmLabel = 'Confirm';
  export let cancelLabel = 'Cancel';
  /** Paints the confirm button as destructive. Set for anything irreversible. */
  export let destructive = false;
  /** Disables the confirm button while the action is in flight. */
  export let busy = false;

  export let onconfirm: () => void = () => {};
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      {#if body}<Dialog.Description>{body}</Dialog.Description>{/if}
    </Dialog.Header>
    <slot />
    <Dialog.Footer>
      <Button variant="outline" disabled={busy} onclick={() => (open = false)}>{cancelLabel}</Button>
      <Button variant={destructive ? 'destructive' : 'default'} disabled={busy} onclick={onconfirm}>
        {busy ? 'Working' : confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
