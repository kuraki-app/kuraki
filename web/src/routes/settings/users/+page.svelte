<script lang="ts">
  import { onMount } from 'svelte';
  import { UserPlus, Trash2, ShieldCheck, Ban, Undo2 } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import type { UserSummary } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { Button } from '$lib/components/ui/button';

  let users: UserSummary[] = [];
  let loading = true;
  /** Non-admins get 403 from every route on this page; show that plainly. */
  let forbidden = false;
  let busy: Record<string, boolean> = {};

  let newUsername = '';
  let newPassword = '';
  let newRole: 'user' | 'admin' = 'user';
  let creating = false;

  onMount(load);

  async function load() {
    try {
      users = (await api.users()).users;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load accounts';
      if (message.includes('admin_required')) forbidden = true;
      else showToast(message);
    } finally {
      loading = false;
    }
  }

  async function create() {
    if (!newUsername.trim()) return;
    creating = true;
    try {
      await api.createUser({ username: newUsername.trim(), password: newPassword, role: newRole });
      showToast(`Created ${newUsername.trim()}`);
      newUsername = '';
      newPassword = '';
      newRole = 'user';
      await load();
    } catch (e) {
      showToast(friendly(e, 'Could not create the account'));
    } finally {
      creating = false;
    }
  }

  async function setDisabled(u: UserSummary, disabled: boolean) {
    busy = { ...busy, [u.id]: true };
    try {
      await api.patchUser(u.id, { disabled });
      showToast(`${u.username} ${disabled ? 'disabled' : 'enabled'}`);
      await load();
    } catch (e) {
      showToast(friendly(e, 'Could not update the account'));
    } finally {
      busy = { ...busy, [u.id]: false };
    }
  }

  async function setRole(u: UserSummary, role: 'user' | 'admin') {
    busy = { ...busy, [u.id]: true };
    try {
      await api.patchUser(u.id, { role });
      showToast(`${u.username} is now ${role}`);
      await load();
    } catch (e) {
      showToast(friendly(e, 'Could not change the role'));
    } finally {
      busy = { ...busy, [u.id]: false };
    }
  }

  // Deletion is two-step by design. The server refuses while the account owns
  // assets; only an explicit purge destroys a library, and the confirmation
  // names the count so nobody discards photos by reflex.
  async function remove(u: UserSummary) {
    busy = { ...busy, [u.id]: true };
    try {
      await api.deleteUser(u.id);
      showToast(`Deleted ${u.username}`);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message.includes('user_has_assets')) {
        const ok = confirm(
          `${u.username} still has ${u.asset_count} photo${u.asset_count === 1 ? '' : 's'}.\n\n` +
            `Deleting the account will permanently destroy them, including the original files. ` +
            `This cannot be undone.\n\nDelete ${u.username} and their entire library?`
        );
        if (ok) {
          try {
            await api.deleteUser(u.id, true);
            showToast(`Deleted ${u.username} and their library`);
            await load();
          } catch (err) {
            showToast(friendly(err, 'Could not delete the account'));
          }
        }
      } else {
        showToast(friendly(e, 'Could not delete the account'));
      }
    } finally {
      busy = { ...busy, [u.id]: false };
    }
  }

  function friendly(e: unknown, fallback: string): string {
    const raw = e instanceof Error ? e.message : '';
    if (raw.includes('last_admin')) return 'This is the only admin — promote someone else first.';
    if (raw.includes('cannot_delete_self')) return 'You cannot delete your own account.';
    if (raw.includes('username_taken')) return 'That username is already taken.';
    if (raw.includes('password_too_short')) return 'Password must be at least 8 characters.';
    if (raw.includes('admin_required')) return 'Only an admin can do that.';
    return raw || fallback;
  }
</script>

<PageHeader title="Users" subtitle="Accounts on this server" />

{#if forbidden}
  <p class="empty">Only an admin can manage accounts.</p>
{:else if loading}
  <p class="empty">Loading…</p>
{:else}
  <section class="add">
    <h3>Add an account</h3>
    <p class="hint">
      Each account gets its own private library. Admins manage accounts and server settings — they
      cannot see other people's photos.
    </p>
    <form on:submit|preventDefault={create}>
      <input bind:value={newUsername} placeholder="Username" autocomplete="off" required />
      <input
        bind:value={newPassword}
        type="password"
        placeholder="Password (min 8)"
        autocomplete="new-password"
        minlength="8"
        required
      />
      <select bind:value={newRole} aria-label="Role">
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>
      <Button type="submit" disabled={creating}>
        <UserPlus size={15} aria-hidden="true" />
        {creating ? 'Adding…' : 'Add'}
      </Button>
    </form>
  </section>

  <ul class="list">
    {#each users as u (u.id)}
      <li class:disabled={!!u.disabled_at}>
        <div class="who">
          <span class="name">{u.username}</span>
          {#if u.role === 'admin'}
            <span class="tag admin"><ShieldCheck size={12} aria-hidden="true" /> Admin</span>
          {/if}
          {#if u.disabled_at}
            <span class="tag off">Disabled</span>
          {/if}
        </div>
        <span class="count">{u.asset_count} photo{u.asset_count === 1 ? '' : 's'}</span>
        <div class="actions">
          {#if u.role === 'admin'}
            <Button variant="ghost" size="sm" disabled={busy[u.id]} onclick={() => setRole(u, 'user')}>
              Demote
            </Button>
          {:else}
            <Button variant="ghost" size="sm" disabled={busy[u.id]} onclick={() => setRole(u, 'admin')}>
              Make admin
            </Button>
          {/if}
          {#if u.disabled_at}
            <Button variant="ghost" size="sm" disabled={busy[u.id]} onclick={() => setDisabled(u, false)}>
              <Undo2 size={15} aria-hidden="true" /> Enable
            </Button>
          {:else}
            <Button variant="ghost" size="sm" disabled={busy[u.id]} onclick={() => setDisabled(u, true)}>
              <Ban size={15} aria-hidden="true" /> Disable
            </Button>
          {/if}
          <Button variant="ghost" size="sm" disabled={busy[u.id]} onclick={() => remove(u)}>
            <Trash2 size={15} aria-hidden="true" /> Delete
          </Button>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    color: var(--text-dim);
    font-size: 14px;
  }
  .add {
    margin-bottom: calc(var(--space-step) * 4);
  }
  .add h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 4px;
  }
  .hint {
    color: var(--text-dim);
    font-size: 13px;
    margin: 0 0 12px;
    max-width: 60ch;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  input,
  select {
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: var(--frame-radius);
    background: var(--background);
    color: var(--foreground);
    font-size: 13px;
    min-width: 0;
  }
  input {
    flex: 1 1 180px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--frame-radius);
    border: 1px solid var(--border);
  }
  .list li.disabled .name {
    text-decoration: line-through;
    color: var(--text-dim);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .name {
    font-weight: 500;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .tag.admin {
    color: var(--stamp);
  }
  .count {
    color: var(--text-dim);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
  }
  @media (max-width: 640px) {
    .list li {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .actions {
      grid-column: 1 / -1;
    }
  }
</style>
