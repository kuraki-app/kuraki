<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import {
    Images,
    Star,
    FolderOpen,
    CalendarClock,
    MapPin,
    Trash2,
    BarChart3,
    Activity,
    Upload,
    LogOut,
    Lock
  } from '@lucide/svelte';
  import { api, uploadFiles } from '$lib/api';
  import { session, bumpLibrary, toast, showToast } from '$lib/stores';

  let username = 'owner';
  let password = '';
  let authBusy = false;
  let authError = '';
  let dragging = false;
  let uploadPct = -1;
  let importStatus = '';
  let fileInput: HTMLInputElement;

  const nav = [
    { href: '/', label: 'Timeline', icon: Images },
    { href: '/favorites', label: 'Favorites', icon: Star },
    { href: '/albums', label: 'Albums', icon: FolderOpen },
    { href: '/memories', label: 'On this day', icon: CalendarClock },
    { href: '/places', label: 'Places', icon: MapPin },
    { href: '/stats', label: 'Library', icon: BarChart3 },
    { href: '/activity', label: 'Activity', icon: Activity },
    { href: '/trash', label: 'Trash', icon: Trash2 }
  ];

  onMount(init);

  async function init() {
    try {
      const s = await api.setupStatus();
      session.set({ checking: false, setupRequired: s.setup_required, user: s.user ?? null });
    } catch {
      session.set({ checking: false, setupRequired: false, user: null });
      showToast('Unable to reach server');
    }
  }

  async function submitAuth() {
    authBusy = true;
    authError = '';
    try {
      const s = $session.setupRequired
        ? await api.setup(username, password)
        : await api.login(username, password);
      session.set({ checking: false, setupRequired: s.setup_required, user: s.user ?? null });
      password = '';
    } catch (e) {
      authError = e instanceof Error ? e.message : 'Authentication failed';
    } finally {
      authBusy = false;
    }
  }

  async function logout() {
    await api.logout();
    session.set({ checking: false, setupRequired: false, user: null });
  }

  async function doUpload(files: File[]) {
    if (!files.length) return;
    uploadPct = 0;
    try {
      const { job_id } = await uploadFiles(files, (p) => (uploadPct = p));
      uploadPct = -1;
      if (!job_id) {
        bumpLibrary();
        return;
      }
      importStatus = 'Importing…';
      await pollJob(job_id);
      bumpLibrary();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      uploadPct = -1;
      importStatus = '';
    }
  }

  async function pollJob(id: string) {
    for (let i = 0; i < 900; i++) {
      let job;
      try {
        job = await api.job(id);
      } catch {
        return;
      }
      importStatus = `Importing ${job.imported}/${job.total}`;
      if (job.status === 'succeeded') {
        showToast(`Imported ${job.imported}${job.duplicates ? `, ${job.duplicates} duplicate` : ''}`);
        return;
      }
      if (job.status === 'failed') {
        showToast(`Import failed${job.error ? ': ' + job.error : ''}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files?.length) doUpload(Array.from(e.dataTransfer.files));
  }

  $: isActive = (href: string) =>
    href === '/' ? $page.url.pathname === '/' : $page.url.pathname.startsWith(href);
</script>

<svelte:head>
  <title>Kuraki</title>
  <meta name="theme-color" content="#f6f3ee" />
</svelte:head>

{#if $session.checking}
  <div class="boot">Loading…</div>
{:else if !$session.user}
  <div class="auth">
    <form on:submit|preventDefault={submitAuth}>
      <Lock size={22} aria-hidden="true" />
      <h2>{$session.setupRequired ? 'Create admin access' : 'Sign in'}</h2>
      <input bind:value={username} autocomplete="username" placeholder="Username" />
      <input
        bind:value={password}
        type="password"
        autocomplete={$session.setupRequired ? 'new-password' : 'current-password'}
        placeholder="Password"
      />
      {#if authError}<p class="err">{authError}</p>{/if}
      <button disabled={authBusy}
        >{authBusy ? 'Working' : $session.setupRequired ? 'Set up' : 'Sign in'}</button
      >
    </form>
  </div>
{:else}
  <div
    class="app"
    role="application"
    on:dragover|preventDefault={() => (dragging = true)}
    on:dragleave={() => (dragging = false)}
    on:drop={onDrop}
  >
    <aside class="side">
      <a class="brand" href="/">蔵 Kuraki</a>
      <nav>
        {#each nav as item (item.href)}
          <a href={item.href} class:active={isActive(item.href)}>
            <svelte:component this={item.icon} size={18} />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>
      <div class="side-foot">
        <button class="up" type="button" on:click={() => fileInput.click()}>
          <Upload size={18} /> <span>Upload</span>
        </button>
        <button class="lo" type="button" on:click={logout} aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </div>
    </aside>

    <main class="content"><slot /></main>

    <input
      bind:this={fileInput}
      type="file"
      multiple
      accept="image/*,video/*"
      hidden
      on:change={(e) => {
        const t = e.currentTarget;
        if (t.files?.length) doUpload(Array.from(t.files));
        t.value = '';
      }}
    />
    {#if dragging}<div class="drop">Drop to upload</div>{/if}
    {#if uploadPct >= 0}
      <div class="uploading"><div class="ubar" style="width:{uploadPct}%"></div><span>Uploading {uploadPct}%</span></div>
    {:else if importStatus}
      <div class="uploading"><div class="ubar indet"></div><span>{importStatus}</span></div>
    {/if}
  </div>
{/if}

{#if $toast}<div class="toast">{$toast}</div>{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    min-width: 320px;
    background: #f6f3ee;
    color: #171717;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  :global(button),
  :global(input) {
    font: inherit;
  }

  .boot,
  .auth {
    display: grid;
    place-items: center;
    min-height: 100vh;
    color: #6a6259;
  }
  .auth form {
    display: grid;
    width: min(360px, 90vw);
    gap: 12px;
    color: #24211f;
  }
  .auth h2 {
    margin: 0;
    font-size: 22px;
  }
  .auth input {
    height: 44px;
    padding: 0 12px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
  }
  .auth button {
    min-height: 44px;
    border: 0;
    border-radius: 8px;
    background: #24211f;
    color: #fff;
    font-weight: 700;
    cursor: pointer;
  }
  .auth button:disabled {
    opacity: 0.7;
  }
  .err {
    margin: 0;
    color: #a33a2a;
    font-size: 14px;
  }

  .app {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    min-height: 100vh;
  }
  .side {
    position: sticky;
    top: 0;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100vh;
    padding: 18px 14px;
    border-right: 1px solid #e5ddd1;
    background: #fbf8f2;
  }
  .brand {
    padding: 6px 10px 14px;
    font-size: 20px;
    font-weight: 700;
    color: #24211f;
    text-decoration: none;
  }
  nav {
    display: grid;
    gap: 3px;
  }
  nav a {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 12px;
    border-radius: 8px;
    color: #4f4942;
    text-decoration: none;
    font-weight: 500;
  }
  nav a.active {
    background: #efe7da;
    color: #201d1a;
  }
  .side-foot {
    display: flex;
    gap: 8px;
    margin-top: auto;
  }
  .up {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    height: 42px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: #24211f;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .lo {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
    color: #4f4942;
    cursor: pointer;
  }
  .content {
    width: min(1440px, 100%);
    padding: 22px;
  }
  .drop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: #24211fcc;
    color: #fff;
    font-size: 24px;
    font-weight: 700;
    pointer-events: none;
  }
  .uploading {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 26;
    width: 240px;
    padding: 12px 14px;
    border-radius: 10px;
    background: #24211f;
    color: #fff;
    box-shadow: 0 12px 30px #0003;
  }
  .uploading .ubar {
    height: 4px;
    margin-bottom: 8px;
    border-radius: 4px;
    background: #ffd35c;
    transition: width 150ms ease;
  }
  .uploading .ubar.indet {
    width: 40%;
    animation: indet 1.1s infinite ease-in-out;
  }
  @keyframes indet {
    0% {
      margin-left: 0;
    }
    50% {
      margin-left: 60%;
    }
    100% {
      margin-left: 0;
    }
  }
  .uploading span {
    font-size: 13px;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 76px;
    transform: translateX(-50%);
    z-index: 45;
    padding: 10px 18px;
    border-radius: 999px;
    background: #201d1a;
    color: #f7f3ec;
    font-size: 14px;
    box-shadow: 0 10px 24px #0003;
  }

  @media (max-width: 820px) {
    .app {
      grid-template-columns: 1fr;
    }
    .side {
      position: sticky;
      top: 0;
      z-index: 15;
      flex-direction: row;
      align-items: center;
      height: auto;
      padding: 10px 12px;
      border-right: 0;
      border-bottom: 1px solid #e5ddd1;
      overflow-x: auto;
    }
    .brand {
      padding: 0 8px 0 4px;
      white-space: nowrap;
    }
    nav {
      grid-auto-flow: column;
      gap: 2px;
    }
    nav a span {
      display: none;
    }
    .side-foot {
      margin-top: 0;
      margin-left: auto;
    }
    .up span {
      display: none;
    }
    .up {
      width: 42px;
      flex: none;
      justify-content: center;
      padding: 0;
    }
    .content {
      padding: 16px;
    }
  }
</style>
