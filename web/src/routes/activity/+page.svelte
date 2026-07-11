<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { CheckCircle2, XCircle, Loader, Clock } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { relativeTime } from '$lib/format';
  import type { Job, MediaIssue } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';

  let jobs: Job[] = [];
  let mediaIssues: MediaIssue[] = [];
  let loading = true;
  let timer: ReturnType<typeof setInterval>;
  let open: Record<string, boolean> = {};
  let details: Record<string, { filename: string; error: string }[]> = {};
  let rebuilding: Record<string, boolean> = {};

  async function rebuild(id: string) {
    rebuilding = { ...rebuilding, [id]: true };
    try {
      await api.rebuildAsset(id);
      showToast('Rebuilding derivative…');
      setTimeout(load, 1500);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Rebuild failed');
    } finally {
      setTimeout(() => (rebuilding = { ...rebuilding, [id]: false }), 1500);
    }
  }

  async function toggle(id: string) {
    if (open[id]) {
      open = { ...open, [id]: false };
      return;
    }
    if (!details[id]) {
      try {
        const d = await api.job(id);
        details = { ...details, [id]: d.errors_detail ?? [] };
      } catch {
        details = { ...details, [id]: [] };
      }
    }
    open = { ...open, [id]: true };
  }

  async function load() {
    try {
      const [jobList, issueList] = await Promise.all([api.jobs(), api.mediaIssues()]);
      jobs = jobList.jobs;
      mediaIssues = issueList.issues;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
    timer = setInterval(load, 2000);
  });
  onDestroy(() => clearInterval(timer));

  const kindLabel = (k: string) => (k === 'upload' ? 'Upload' : 'Import');
  const pct = (j: Job) => (j.total ? Math.round((j.imported / j.total) * 100) : 0);
</script>

<PageHeader title="Activity" subtitle="Recent imports" />

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  {#if mediaIssues.length > 0}
    <section class="media-health" aria-labelledby="media-health-title">
      <h2 id="media-health-title">Media health</h2>
      <p>These originals are safe, but need a compatible preview or playback derivative.</p>
      <ul>
        {#each mediaIssues as issue (issue.asset_id + issue.kind)}
          <li>
            <div class="mi-text">
              <strong>{issue.filename}</strong><span>{issue.kind}: {issue.message}</span>
            </div>
            <button
              class="rebuild"
              type="button"
              disabled={rebuilding[issue.asset_id]}
              on:click={() => rebuild(issue.asset_id)}
            >
              {rebuilding[issue.asset_id] ? 'Rebuilding…' : 'Rebuild'}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if jobs.length === 0}
    {#if mediaIssues.length === 0}<EmptyState title="No recent activity" />{/if}
  {:else}
  <div class="list">
    {#each jobs as job (job.id)}
      <div class="job">
        <div class="icon {job.status}">
          {#if job.status === 'succeeded'}
            <CheckCircle2 size={20} />
          {:else if job.status === 'failed'}
            <XCircle size={20} />
          {:else if job.status === 'running'}
            <Loader size={20} class="spin" />
          {:else}
            <Clock size={20} />
          {/if}
        </div>
        <div class="body">
          <div class="row1">
            <strong>{kindLabel(job.kind)}</strong>
            <span class="pill {job.status}">{job.status}</span>
            <span class="time">{relativeTime(job.created_at)}</span>
          </div>
          <div class="row2">
            {#if job.status === 'succeeded'}
              {job.imported} imported{#if job.duplicates}, {job.duplicates} duplicate{/if}{#if job.skipped && !job.duplicates}, {job.skipped} skipped{/if}{#if job.errors}, {job.errors} error{/if}
            {:else if job.status === 'failed'}
              <span class="err">{job.error || 'Import failed'}{#if job.attempts} · {job.attempts} attempts{/if}</span>
            {:else}
              {job.imported}/{job.total}{#if job.attempts > 0} · retry {job.attempts}{/if}
            {/if}
          </div>
          {#if job.status === 'queued' || job.status === 'running'}
            <div class="track"><div class="fill" style="width:{pct(job)}%"></div></div>
          {/if}
          {#if job.errors > 0}
            <button class="errbtn" type="button" on:click={() => toggle(job.id)}>
              {open[job.id] ? 'Hide' : `Show ${job.errors} error${job.errors === 1 ? '' : 's'}`}
            </button>
            {#if open[job.id]}
              <ul class="errlist">
                {#each details[job.id] ?? [] as e}
                  <li><span class="fn">{e.filename}</span><span class="msg">{e.error}</span></li>
                {/each}
                {#if (details[job.id] ?? []).length === 0}
                  <li class="msg">No detail available</li>
                {/if}
              </ul>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
  {/if}
{/if}

<style>
  .muted {
    color: var(--muted-foreground);
  }
  .list {
    display: grid;
    gap: 8px;
  }
  .media-health {
    margin-bottom: 20px;
    padding: 14px;
    border: 1px solid var(--warn-border);
    border-radius: 12px;
    background: var(--warn-bg);
  }
  .media-health h2 { margin: 0; font-size: 16px; }
  .media-health p { margin: 5px 0 10px; color: var(--muted-foreground); font-size: 13px; }
  .media-health ul { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
  .media-health li { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .media-health .mi-text { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
  .media-health .mi-text span { color: var(--warn-text); }
  .media-health .rebuild {
    margin-left: auto;
    flex: none;
    padding: 5px 12px;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
    cursor: pointer;
    font-size: 13px;
  }
  .media-health .rebuild:disabled { opacity: 0.6; cursor: default; }
  .job {
    display: grid;
    grid-template-columns: 40px 1fr;
    align-items: start;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--card);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--accent);
    color: var(--muted-foreground);
  }
  .icon.succeeded {
    color: var(--ok);
    background: var(--ok-bg);
  }
  .icon.failed {
    color: var(--destructive);
    background: var(--destructive-bg);
  }
  .icon.running {
    color: var(--info);
    background: var(--info-bg);
  }
  .body {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .row1 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row1 strong {
    color: var(--foreground);
  }
  .pill {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--muted);
    color: var(--text-dim);
    font-size: 12px;
    text-transform: capitalize;
  }
  .pill.succeeded {
    background: var(--ok-bg);
    color: var(--ok);
  }
  .pill.failed {
    background: var(--destructive-bg);
    color: var(--destructive);
  }
  .pill.running {
    background: var(--info-bg);
    color: var(--info);
  }
  .time {
    margin-left: auto;
    color: var(--text-faint);
    font-size: 13px;
    white-space: nowrap;
  }
  .row2 {
    color: var(--text-dim);
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .err {
    color: var(--destructive);
  }
  .errbtn {
    justify-self: start;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--warn);
    cursor: pointer;
    font-size: 13px;
    text-decoration: underline;
  }
  .errlist {
    display: grid;
    gap: 6px;
    margin: 2px 0 0;
    padding: 10px 12px;
    list-style: none;
    border-radius: 8px;
    background: var(--warn-bg);
  }
  .errlist li {
    display: grid;
    gap: 2px;
    font-size: 13px;
  }
  .errlist .fn {
    font-weight: 600;
    color: var(--foreground);
    overflow-wrap: anywhere;
  }
  .errlist .msg {
    color: var(--warn-text);
    overflow-wrap: anywhere;
  }
  .track {
    height: 6px;
    border-radius: 4px;
    background: var(--muted);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--primary);
    transition: width 200ms ease;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
