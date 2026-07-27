<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { Smartphone, RefreshCw, Download, Trash2 } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { relativeTime } from '$lib/format';
  import type { DeviceInfo } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { Button } from '$lib/components/ui/button';

  let qrSvg = '';
  let expiresAt = '';
  let loading = false;

  let devices: DeviceInfo[] = [];
  let devicesLoading = true;
  let revoking: Record<string, boolean> = {};

  onMount(loadDevices);

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
      const payload = base64url(JSON.stringify({ base_url: location.origin, code: res.code }));
      const qrData = `kuraki://pair?d=${payload}`;
      qrSvg = await QRCode.toString(qrData, { type: 'svg', margin: 1, width: 240 });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not create a pairing code');
    } finally {
      loading = false;
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
    <li>Generate a code below and scan it. The phone receives its own revocable token.</li>
    <li>Turn on <strong>Automatic backup</strong> on the phone.</li>
  </ol>

  <a class="download" href="/download/android" download>
    <Download size={15} aria-hidden="true" /> Download the Android app (.apk)
  </a>

  {#if qrSvg}
    <div class="qr">{@html qrSvg}</div>
    <p class="hint">Scan with the Kuraki app only. Expires at {expiryLabel}. Single use — generate a new one if it expires.</p>
    <Button variant="outline" onclick={pair} disabled={loading}>
      <RefreshCw size={15} aria-hidden="true" /> New code
    </Button>
  {:else}
    <Button onclick={pair} disabled={loading}>
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
