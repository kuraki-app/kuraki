<script lang="ts">
  // The naming counterpart to ConfirmDialog, replacing native `prompt()`.
  //
  // Same reasons as ConfirmDialog — unstylable, unthemable, main-thread
  // blocking, suppressed outright in some contexts — plus one specific to
  // `prompt()`: it cannot show a validation state, so "Album name" with an empty
  // string had no way to say why nothing happened.
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  export let open = false;
  export let title: string;
  export let label = 'Name';
  export let placeholder = '';
  export let value = '';
  export let confirmLabel = 'Save';
  export let busy = false;

  export let onsubmit: (value: string) => void = () => {};

  const id = `prompt-${Math.random().toString(36).slice(2, 8)}`;

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onsubmit(trimmed);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
    </Dialog.Header>
    <form
      class="grid gap-2"
      on:submit|preventDefault={submit}
    >
      <Label for={id}>{label}</Label>
      <!-- Enter submits, which is the one behaviour people actually relied on
           `prompt()` for. -->
      <Input {id} bind:value {placeholder} autocomplete="off" />
    </form>
    <Dialog.Footer>
      <Button variant="outline" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
      <Button disabled={busy || !value.trim()} onclick={submit}>
        {busy ? 'Working' : confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
