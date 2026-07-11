<script lang="ts">
  import QRCode from 'qrcode';
  import { Smartphone, RefreshCw } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { Button } from '$lib/components/ui/button';

  let qrSvg = '';
  let code = '';
  let expiresAt = '';
  let loading = false;

  async function pair() {
    loading = true;
    try {
      const res = await api.createPairingCode();
      code = res.code;
      expiresAt = res.expires_at;
      // The phone needs both where to reach this server and the one-time code.
      const payload = JSON.stringify({ base_url: location.origin, code: res.code });
      qrSvg = await QRCode.toString(payload, { type: 'svg', margin: 1, width: 240 });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not create a pairing code');
    } finally {
      loading = false;
    }
  }

  $: expiryLabel = expiresAt ? new Date(expiresAt).toLocaleTimeString() : '';
</script>

<PageHeader title="Devices" subtitle="Pair a phone to back up its camera roll to this server." />

<section class="card">
  <h2><Smartphone size={18} aria-hidden="true" /> Pair a phone</h2>
  <ol>
    <li>Install the Kuraki app and open <strong>Settings → Scan QR to pair</strong>.</li>
    <li>Generate a code below and scan it. The phone receives its own revocable token.</li>
    <li>Turn on <strong>Automatic backup</strong> on the phone.</li>
  </ol>

  {#if qrSvg}
    <div class="qr">{@html qrSvg}</div>
    <p class="code">Code: <code>{code}</code></p>
    <p class="hint">Expires at {expiryLabel}. Single use. Generate a new one if it expires.</p>
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
  }
  .card h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 700;
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
    /* Always white so the QR stays scannable regardless of theme. */
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
  .code {
    text-align: center;
    margin: 0 0 4px;
    font-size: 14px;
  }
  .code code {
    font-size: 12px;
    word-break: break-all;
    color: var(--muted-foreground);
  }
  .hint {
    text-align: center;
    color: var(--muted-foreground);
    font-size: 13px;
    margin: 0 0 14px;
  }
</style>
