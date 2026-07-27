<script lang="ts">
  import { KeyRound } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let current = '';
  let next = '';
  let confirm = '';
  let busy = false;

  $: tooShort = next.length > 0 && next.length < 8;
  $: mismatch = confirm.length > 0 && next !== confirm;
  $: canSubmit = !busy && current.length > 0 && next.length >= 8 && next === confirm;

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    busy = true;
    try {
      await api.changePassword(current, next);
      current = next = confirm = '';
      showToast('Password changed. Other sessions were signed out.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not change password';
      showToast(msg === 'invalid_credentials' ? 'Current password is incorrect' : msg);
    } finally {
      busy = false;
    }
  }
</script>

<PageHeader title="Account" subtitle="Manage your sign-in." />

<section class="card">
  <h2><KeyRound size={18} aria-hidden="true" /> Change password</h2>
  <p class="hint">
    Changing your password signs out every other browser and device session. Your
    paired phones keep their own device tokens and are unaffected.
  </p>
  <form on:submit={submit}>
    <div class="field">
      <Label for="current">Current password</Label>
      <Input id="current" type="password" autocomplete="current-password" bind:value={current} />
    </div>
    <div class="field">
      <Label for="next">New password</Label>
      <Input id="next" type="password" autocomplete="new-password" bind:value={next} aria-invalid={tooShort} />
      {#if tooShort}<span class="err">At least 8 characters.</span>{/if}
    </div>
    <div class="field">
      <Label for="confirm">Confirm new password</Label>
      <Input id="confirm" type="password" autocomplete="new-password" bind:value={confirm} aria-invalid={mismatch} />
      {#if mismatch}<span class="err">Passwords do not match.</span>{/if}
    </div>
    <Button type="submit" disabled={!canSubmit}>{busy ? 'Saving…' : 'Change password'}</Button>
  </form>
</section>

<style>
  .card {
    max-width: 420px;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--card);
  }
  .card h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 700;
  }
  .hint {
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.6;
    margin: 0 0 16px;
  }
  form {
    display: grid;
    gap: 14px;
  }
  .field {
    display: grid;
    gap: 6px;
  }
  .err {
    color: var(--destructive);
    font-size: 12px;
  }
</style>
