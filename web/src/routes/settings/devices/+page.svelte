<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { Smartphone, RefreshCw, Download, Trash2, Copy, Check, TriangleAlert } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { relativeTime } from '$lib/format';
  import type { DeviceInfo } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { Button } from '$lib/components/ui/button';

  let qrSvg = '';
  let expiresAt = '';
  let loading = false;
  let code = '';
  let copied = false;

  // The address the phone is told to connect to. It seeds from this tab's own
  // origin, but that is only right when the browser reached the server over the
  // network. An owner administering the server from the machine it runs on sees
  // localhost here, and a phone that "connects to localhost" connects to
  // itself — so this is editable, and warned about below.
  let serverURL = '';

  let devices: DeviceInfo[] = [];
  let devicesLoading = true;
  let revoking: Record<string, boolean> = {};

  onMount(() => {
    serverURL = location.origin;
    void loadDevices();
  });

  function hostnameOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    } catch {
      return '';
    }
  }

  $: host = hostnameOf(serverURL);
  $: loopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  $: addressUsable = host !== '' && !loopback;

  async function loadDevices() {
    try {
      devices = (await api.devices()).devices;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load devices');
    } finally {
      devicesLoading = false;
    }
  }

  async function revoke(d: DeviceInfo) {
    revoking = { ...revoking, [d.id]: true };
    try {
      await api.revokeDevice(d.id);
      devices = devices.filter((x) => x.id !== d.id);
      showToast(`${d.name} revoked`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      revoking = { ...revoking, [d.id]: false };
    }
  }

  function base64url(s: string): string {
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function pair() {
    loading = true;
    try {
      const res = await api.createPairingCode();
      expiresAt = res.expires_at;
      code = res.code;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not create a pairing code');
    } finally {
      loading = false;
    }
  }

  // Re-rendered whenever the code or the address changes, so correcting a
  // localhost address updates the QR in place — the code itself stays valid for
  // its full five minutes, no need to mint a new one.
  async function renderQR(activeCode: string, url: string) {
    const payload = base64url(JSON.stringify({ base_url: url.replace(/\/+$/, ''), code: activeCode }));
    qrSvg = await QRCode.toString(`kuraki://pair?d=${payload}`, { type: 'svg', margin: 1, width: 240 });
  }

  $: if (code && serverURL) void renderQR(code, serverURL);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      showToast('Could not copy — select the code and copy it manually.');
    }
  }

  $: expiryLabel = expiresAt ? new Date(expiresAt).toLocaleTimeString() : '';
</script>

<PageHeader title="Devices" subtitle="Pair a phone to back up its camera roll to this server." />

{#if !devicesLoading && devices.length > 0}
  <section class="card">
    <h2><Smartphone size={18} aria-hidden="true" /> Paired devices</h2>
    <ul class="devices">
      {#each devices as d (d.id)}
        <li>
          <div class="d-text">
            <strong>{d.name}</strong>
            <span>Paired {relativeTime(d.created_at)}{#if d.last_seen_at} · last seen {relativeTime(d.last_seen_at)}{/if}</span>
          </div>
          <Button variant="outline" size="sm" disabled={revoking[d.id]} onclick={() => revoke(d)}>
            <Trash2 size={14} aria-hidden="true" /> Revoke
          </Button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card">
  <h2><Smartphone size={18} aria-hidden="true" /> Pair a phone</h2>
  <ol>
    <li>Install the Kuraki app and open <strong>Settings → Scan QR to pair</strong>.</li>
    <li>Generate a code below, then either scan the QR or type the code into the app.</li>
    <li>Turn on <strong>Automatic backup</strong> on the phone.</li>
  </ol>

  <a class="download" href="/download/android" download>
    <Download size={15} aria-hidden="true" /> Download the Android app (.apk)
  </a>

  <label class="field" for="server-url">Address the phone should connect to</label>
  <input id="server-url" class="input" bind:value={serverURL} spellcheck="false" autocomplete="off" />
  {#if loopback}
    <p class="warn">
      <TriangleAlert size={15} aria-hidden="true" />
      <span>
        <strong>{host}</strong> only means “this machine”. A phone using it would try to reach itself.
        Replace it with this server’s address on your network (for example <code>http://192.168.1.20:3000</code>).
      </span>
    </p>
  {/if}

  {#if code}
    <div class="qr">{@html qrSvg}</div>

    <div class="code-row">
      <code class="code">{code}</code>
      <Button variant="outline" size="sm" onclick={copyCode} aria-label="Copy pairing code">
        {#if copied}<Check size={14} aria-hidden="true" /> Copied{:else}<Copy size={14} aria-hidden="true" /> Copy{/if}
      </Button>
    </div>
    <p class="hint">
      Scan the QR, or type the code into the app — either works, and both need the address above.
      Expires at {expiryLabel}. Single use.
    </p>

    <Button variant="outline" onclick={pair} disabled={loading}>
      <RefreshCw size={15} aria-hidden="true" /> New code
    </Button>
  {:else}
    <Button onclick={pair} disabled={loading || !addressUsable}>
      {loading ? 'Generating…' : 'Generate pairing code'}
    </Button>
  {/if}
</section>

<style>
  .card {
    max-width: 420px;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--card);
    margin-bottom: 16px;
  }
  .card h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 700;
  }
  .devices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .devices li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .devices li:last-child {
    border-bottom: 0;
  }
  .d-text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .d-text span {
    color: var(--muted-foreground);
    font-size: 12px;
  }
  ol {
    margin: 0 0 16px;
    padding-left: 20px;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1.6;
  }
  .qr {
    width: 240px;
    max-width: 100%;
    margin: 0 auto 12px;
    background: #fff;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
  }
  .qr :global(svg) {
    width: 100%;
    height: auto;
    display: block;
  }
  .hint {
    text-align: center;
    color: var(--muted-foreground);
    font-size: 13px;
    margin: 0 0 14px;
  }
  .field {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .input {
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 12px;
    font-size: 14px;
    font-family: inherit;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .warn {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: -4px 0 14px;
    padding: 10px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--foreground);
    background: var(--destructive-bg, rgba(220, 38, 38, 0.08));
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .warn :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .warn code {
    font-size: 12px;
    word-break: break-all;
  }
  .code-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .code {
    flex: 1;
    min-width: 0;
    padding: 10px;
    font-size: 13px;
    letter-spacing: 0.02em;
    text-align: center;
    word-break: break-all;
    user-select: all;
    background: var(--muted, rgba(127, 127, 127, 0.1));
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .download {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 16px;
    font-size: 14px;
    color: var(--primary, #208aef);
    text-decoration: none;
  }
  .download:hover {
    text-decoration: underline;
  }
</style>
