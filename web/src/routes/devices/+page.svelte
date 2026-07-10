<script lang="ts">
  import QRCode from 'qrcode';
  import { Smartphone, RefreshCw } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';

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

<header class="head">
  <div>
    <h1>Devices</h1>
    <p>Pair a phone to back up its camera roll to this server.</p>
  </div>
</header>

<section class="card">
  <h2><Smartphone size={18} /> Pair a phone</h2>
  <ol>
    <li>Install the Kuraki app and open <strong>Settings → Scan QR to pair</strong>.</li>
    <li>Generate a code below and scan it. The phone receives its own revocable token.</li>
    <li>Turn on <strong>Automatic backup</strong> on the phone.</li>
  </ol>

  {#if qrSvg}
    <div class="qr">{@html qrSvg}</div>
    <p class="code">Code: <code>{code}</code></p>
    <p class="hint">Expires at {expiryLabel}. Single use. Generate a new one if it expires.</p>
    <button type="button" on:click={pair} disabled={loading}>
      <RefreshCw size={15} /> New code
    </button>
  {:else}
    <button type="button" class="primary" on:click={pair} disabled={loading}>
      {loading ? 'Generating…' : 'Generate pairing code'}
    </button>
  {/if}
</section>

<style>
  .head {
    margin-bottom: 20px;
  }
  .head h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
  }
  .head p {
    margin: 3px 0 0;
    color: #6a6259;
    font-size: 14px;
  }
  .card {
    max-width: 420px;
    padding: 20px;
    border: 1px solid #e2dacd;
    border-radius: 12px;
    background: #fffaf3;
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
    color: #4f4942;
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
    border: 1px solid #e2dacd;
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
    color: #6a6259;
  }
  .hint {
    text-align: center;
    color: #6a6259;
    font-size: 13px;
    margin: 0 0 14px;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 16px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
    color: #24211f;
    font-weight: 600;
    cursor: pointer;
  }
  button.primary {
    background: #24211f;
    color: #fff;
    border-color: #24211f;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
