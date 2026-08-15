<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { Upload, LogOut, Lock, Monitor, Sun, Moon } from '@lucide/svelte';
  import { ModeWatcher, setMode, userPrefersMode } from 'mode-watcher';
  import { Toaster } from '$lib/components/ui/sonner';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { api, uploadFiles } from '$lib/api';
  import { session, bumpLibrary, showToast, uploadRequest } from '$lib/stores';
  import { startSync } from '$lib/sync';
  import { defaultView } from '$lib/prefs';
  import { NAV_GROUPS, isActive, registerFor } from '$lib/nav';
  import MobileNav from '$lib/components/MobileNav.svelte';
  import '../app.css';

  let username = 'admin';
  let password = '';
  let confirmPassword = '';
  let authBusy = false;
  let authError = '';

  // Friendly copy for the error codes the auth API returns.
  const authErrorText: Record<string, string> = {
    invalid_credentials: 'Incorrect username or password.',
    password_too_short: 'Password must be at least 8 characters.',
    setup_already_complete: 'Setup is already complete. Please sign in.'
  };
  let dragging = false;
  let uploadPct = -1;
  let importStatus = '';
  let fileInput: HTMLInputElement;

  // Dark mode is owned by mode-watcher: it toggles `.dark` on <html>, persists
  // the choice, and prevents the flash of the wrong theme on load.
  const themeIcon = { system: Monitor, light: Sun, dark: Moon } as const;

  onMount(init);

  // Delta-sync poller: runs only while signed in. Reacts to login/logout by
  // starting on the first authenticated user and stopping when it clears.
  let stopSync: (() => void) | null = null;
  $: {
    if ($session.user && !stopSync) stopSync = startSync();
    else if (!$session.user && stopSync) {
      stopSync();
      stopSync = null;
    }
  }

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
    authError = '';
    // First-run setup: validate the account before hitting the server.
    if ($session.setupRequired) {
      if (password.length < 8) {
        authError = 'Password must be at least 8 characters.';
        return;
      }
      if (password !== confirmPassword) {
        authError = 'Passwords do not match.';
        return;
      }
    }
    authBusy = true;
    try {
      const s = $session.setupRequired
        ? await api.setup(username.trim() || 'admin', password)
        : await api.login(username, password);
      session.set({ checking: false, setupRequired: s.setup_required, user: s.user ?? null });
      if (s.user) {
        const target = get(defaultView);
        if (target !== '/' && $page.url.pathname === '/') goto(target);
      }
      password = '';
      confirmPassword = '';
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      authError = authErrorText[code] ?? (code || 'Authentication failed');
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

  // Any page can ask for the file picker (the timeline's empty state does).
  // The first emission is the store's initial value, not a request — opening a
  // picker on mount would be a jump-scare, so it is skipped.
  let uploadRequests = 0;
  $: if ($uploadRequest > uploadRequests) {
    uploadRequests = $uploadRequest;
    fileInput?.click();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files?.length) doUpload(Array.from(e.dataTransfer.files));
  }
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
      <h1>{$session.setupRequired ? 'Welcome to Kuraki' : 'Sign in'}</h1>
      {#if $session.setupRequired}
        <p class="auth-sub">Create the owner account for this server. You can change the password later in Settings.</p>
      {/if}
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
      {#if $session.setupRequired}
        <label class="sr-only" for="auth-confirm">Confirm password</label>
        <Input
          id="auth-confirm"
          bind:value={confirmPassword}
          type="password"
          autocomplete="new-password"
          placeholder="Confirm password"
          aria-invalid={confirmPassword.length > 0 && confirmPassword !== password}
        />
        <p class="auth-hint">At least 8 characters.</p>
      {/if}
      {#if authError}<p class="err" role="alert">{authError}</p>{/if}
      <Button type="submit" class="w-full" disabled={authBusy}>
        {authBusy ? 'Working' : $session.setupRequired ? 'Create account' : 'Sign in'}
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
      <a class="brand" href="/" aria-label="Kuraki home">
        <svg class="brand-mark" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="4.5" />
          <path d="M12 6.5 17.5 12 12 17.5 6.5 12Z" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
        <span>Kuraki</span>
      </a>
      <nav aria-label="Library sections">
        {#each NAV_GROUPS as group (group.label)}
          <div class="group">
            <h2 class="group-label">{group.label}</h2>
            {#each group.items as item (item.href)}
              <a
                href={item.href}
                class:active={isActive(item.href, $page.url.pathname)}
                aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
              >
                <svelte:component this={item.icon} size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            {/each}
          </div>
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

    <main class="content" id="main" data-register={registerFor($page.url.pathname)}><slot /></main>

    <!-- Below 820px `.side` is hidden, so this is the only route to Upload,
         theme and sign-out; both actions are owned here and handed down. -->
    <MobileNav on:upload={() => fileInput.click()} on:signout={logout} />

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
  .auth-sub {
    margin: -4px 0 4px;
    color: var(--muted-foreground);
    font-size: 14px;
    line-height: 1.5;
  }
  .auth-hint {
    margin: -6px 0 0;
    color: var(--muted-foreground);
    font-size: 12px;
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
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 14px;
    font-size: 20px;
    font-weight: 700;
    color: var(--foreground);
    text-decoration: none;
  }
  /* --stamp, not --highlight: this is Kuraki's mark, and the mark is oxblood.
   * It sits inches above the active nav item's oxblood rule in this same
   * sidebar — an amber mark there was the incoherence the palette work existed
   * to remove. --stamp is contrast-gated against --background/--card. */
  .brand-mark {
    flex: none;
    color: var(--stamp);
  }
  nav {
    display: grid;
    gap: 3px;
  }
  .group {
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
  .group + .group {
    margin-top: 14px;
  }
  .group-label {
    margin: 0 0 4px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .side-foot {
    display: flex;
    gap: 8px;
    margin-top: auto;
  }
  .content {
    /* Full width. This used to be `min(1440px, 100%)`, which capped EVERY page
     * — including the timeline, where the whole point is to show photographs.
     * On a 1920 screen that left ~280px of empty paper to the right of the
     * grid and made the app look like it had failed to fill the window.
     *
     * Surfaces that are READ rather than browsed set their own measure instead
     * (see `.settings-shell`): a line of prose has an ideal length, a contact
     * sheet does not. */
    width: 100%;
    /* This element carries data-register, so it reads its own step: the frame
     * itself tightens from 24px to 12px as you cross into the Vault. */
    padding: calc(var(--space-step) * 3);
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

  /* The sidebar used to collapse into a horizontal scroller with labels
   * hidden — thirteen unidentifiable glyphs. MobileNav replaces it wholesale;
   * everything the sidebar carried (Upload, theme, sign-out) lives in its
   * More sheet. The bottom padding clears the fixed tab bar. */
  @media (max-width: 820px) {
    .app {
      /* minmax(0, 1fr), never a bare 1fr. A bare `1fr` is `minmax(auto, 1fr)`,
       * whose floor is the content's *min-content* width — so one wide,
       * non-wrapping toolbar inside .content stretches the track and drags the
       * whole page past the viewport instead of being contained by it. The
       * desktop track above carries the same guard for the same reason. */
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      display: none;
    }
    .content {
      /* Thumb reach beats rhythm at the bottom edge, but the horizontal step
       * still carries the register. */
      padding: calc(var(--space-step) * 2) calc(var(--space-step) * 2)
        calc(70px + env(safe-area-inset-bottom, 0));
    }
    /* The tab bar now owns the bottom edge; lift the progress toast clear of it
     * rather than let it sit over the tabs. */
    .uploading {
      right: 12px;
      bottom: calc(70px + env(safe-area-inset-bottom, 0));
      width: auto;
      max-width: calc(100vw - 24px);
    }
  }
</style>
