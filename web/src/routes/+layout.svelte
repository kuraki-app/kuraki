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
    Copy,
    Upload,
    LogOut,
    Lock,
    Archive,
    EyeOff,
    Smartphone,
    Settings,
    Monitor,
    Sun,
    Moon
  } from '@lucide/svelte';
  import { ModeWatcher, setMode, userPrefersMode } from 'mode-watcher';
  import { Toaster } from '$lib/components/ui/sonner';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { api, uploadFiles } from '$lib/api';
  import { session, bumpLibrary, showToast } from '$lib/stores';
  import '../app.css';

  let username = 'owner';
  let password = '';
  let authBusy = false;
  let authError = '';
  let dragging = false;
  let uploadPct = -1;
  let importStatus = '';
  let fileInput: HTMLInputElement;

  // Dark mode is owned by mode-watcher: it toggles `.dark` on <html>, persists
  // the choice, and prevents the flash of the wrong theme on load.
  const themeIcon = { system: Monitor, light: Sun, dark: Moon } as const;

  const nav = [
    { href: '/', label: 'Timeline', icon: Images },
    { href: '/favorites', label: 'Favorites', icon: Star },
    { href: '/albums', label: 'Albums', icon: FolderOpen },
    { href: '/memories', label: 'On this day', icon: CalendarClock },
    { href: '/places', label: 'Places', icon: MapPin },
    { href: '/archive', label: 'Archive', icon: Archive },
    { href: '/hidden', label: 'Hidden', icon: EyeOff },
    { href: '/duplicates', label: 'Duplicates', icon: Copy },
    { href: '/stats', label: 'Library', icon: BarChart3 },
    { href: '/devices', label: 'Devices', icon: Smartphone },
    { href: '/activity', label: 'Activity', icon: Activity },
    { href: '/trash', label: 'Trash', icon: Trash2 },
    { href: '/settings', label: 'Settings', icon: Settings }
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
</svelte:head>

{#if $session.checking}
  <div class="boot" role="status">Loading…</div>
{:else if !$session.user}
  <div class="auth">
    <form on:submit|preventDefault={submitAuth}>
      <Lock size={22} aria-hidden="true" />
      <h1>{$session.setupRequired ? 'Create admin access' : 'Sign in'}</h1>
      <label class="sr-only" for="auth-username">Username</label>
      <Input id="auth-username" bind:value={username} autocomplete="username" placeholder="Username" />
      <label class="sr-only" for="auth-password">Password</label>
      <Input
        id="auth-password"
        bind:value={password}
        type="password"
        autocomplete={$session.setupRequired ? 'new-password' : 'current-password'}
        placeholder="Password"
      />
      {#if authError}<p class="err" role="alert">{authError}</p>{/if}
      <Button type="submit" class="w-full" disabled={authBusy}>
        {authBusy ? 'Working' : $session.setupRequired ? 'Set up' : 'Sign in'}
      </Button>
    </form>
  </div>
{:else}
  <a class="skip-link" href="#main">Skip to content</a>
  <!-- The whole page is a drag-and-drop target as a pointer-only enhancement;
       the keyboard-accessible upload path is the Upload button + file input. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="app"
    on:dragover|preventDefault={() => (dragging = true)}
    on:dragleave={() => (dragging = false)}
    on:drop={onDrop}
  >
    <aside class="side">
      <a class="brand" href="/">蔵 Kuraki</a>
      <nav aria-label="Library sections">
        {#each nav as item (item.href)}
          <a
            href={item.href}
            class:active={isActive(item.href)}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            <svelte:component this={item.icon} size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>
      <div class="side-foot">
        <Button class="flex-1" onclick={() => fileInput.click()}>
          <Upload size={18} aria-hidden="true" /> <span>Upload</span>
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="outline" size="icon" aria-label="Theme">
                <svelte:component this={themeIcon[userPrefersMode.current]} size={18} aria-hidden="true" />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item onclick={() => setMode('light')}>
              <Sun size={16} aria-hidden="true" /> Light
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => setMode('dark')}>
              <Moon size={16} aria-hidden="true" /> Dark
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => setMode('system')}>
              <Monitor size={16} aria-hidden="true" /> System
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        <Button variant="outline" size="icon" onclick={logout} aria-label="Sign out">
          <LogOut size={18} aria-hidden="true" />
        </Button>
      </div>
    </aside>

    <main class="content" id="main"><slot /></main>

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
    {#if dragging}<div class="drop" aria-hidden="true">Drop to upload</div>{/if}
    {#if uploadPct >= 0}
      <div class="uploading" role="status"><div class="ubar" style="width:{uploadPct}%"></div><span>Uploading {uploadPct}%</span></div>
    {:else if importStatus}
      <div class="uploading" role="status"><div class="ubar indet"></div><span>{importStatus}</span></div>
    {/if}
  </div>
{/if}

<ModeWatcher />
<Toaster />

<style>
  .boot,
  .auth {
    display: grid;
    place-items: center;
    min-height: 100vh;
    color: var(--muted-foreground);
  }
  .auth form {
    display: grid;
    width: min(360px, 90vw);
    gap: 12px;
    color: var(--foreground);
  }
  .auth h1 {
    margin: 0;
    font-size: 22px;
  }
  .err {
    margin: 0;
    color: var(--destructive);
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
    border-right: 1px solid var(--border);
    background: var(--sidebar);
  }
  .brand {
    padding: 6px 10px 14px;
    font-size: 20px;
    font-weight: 700;
    color: var(--foreground);
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
    color: var(--text-dim);
    text-decoration: none;
    font-weight: 500;
  }
  nav a.active {
    background: var(--accent);
    color: var(--foreground);
  }
  .side-foot {
    display: flex;
    gap: 8px;
    margin-top: auto;
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
    background: var(--scrim);
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
    background: var(--chrome);
    color: var(--chrome-text);
    box-shadow: var(--shadow);
  }
  .uploading .ubar {
    height: 4px;
    margin-bottom: 8px;
    border-radius: 4px;
    background: var(--highlight);
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
      border-bottom: 1px solid var(--border);
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
    .content {
      padding: 16px;
    }
  }
</style>
