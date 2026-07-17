<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    X,
    Download,
    Star,
    Trash2,
    ChevronLeft,
    ChevronRight,
    RotateCcw,
    MapPin,
    Pencil
  } from '@lucide/svelte';
  import type { Asset } from '$lib/types';
  import { fileSize, placeLabel } from '$lib/format';
  import { MORPH_NAME, viewerShowsImage } from '$lib/motion';

  export let assets: Asset[] = [];
  export let index = 0;
  export let trashMode = false;
  export let editable = false;

  const dispatch = createEventDispatcher();
  $: asset = assets[index];
  let imgLoaded = false;
  let editing = false;
  let editDate = '';
  let editCaption = '';
  let editLat = '';
  let editLon = '';
  $: if (index >= 0) {
    imgLoaded = false;
    editing = false;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  function toLocalInput(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function startEdit() {
    editDate = asset.taken_at ? toLocalInput(asset.taken_at) : '';
    editCaption = asset.description ?? '';
    editLat = asset.gps_lat != null ? String(asset.gps_lat) : '';
    editLon = asset.gps_lon != null ? String(asset.gps_lon) : '';
    editing = true;
  }
  function saveEdit() {
    const patch: Record<string, unknown> = { id: asset.id, description: editCaption };
    patch.taken_at = editDate ? new Date(editDate).toISOString() : '';
    const lat = parseFloat(editLat);
    const lon = parseFloat(editLon);
    if (!isNaN(lat) && !isNaN(lon)) {
      patch.gps_lat = lat;
      patch.gps_lon = lon;
    } else if (editLat.trim() === '' && editLon.trim() === '') {
      patch.clear_gps = true;
    }
    editing = false;
    dispatch('patch', patch);
  }

  function move(delta: number) {
    const n = index + delta;
    if (n >= 0 && n < assets.length) dispatch('navigate', n);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowLeft') move(-1);
  }
</script>

<svelte:window on:keydown={key} />

{#if asset}
  <div class="viewer" role="dialog" aria-modal="true">
    <button class="icon close" type="button" on:click={() => dispatch('close')} aria-label="Close">
      <X size={22} />
    </button>
    {#if index > 0}
      <button class="icon nav left" type="button" on:click={() => move(-1)} aria-label="Previous">
        <ChevronLeft size={26} />
      </button>
    {/if}
    {#if index < assets.length - 1}
      <button class="icon nav right" type="button" on:click={() => move(1)} aria-label="Next">
        <ChevronRight size={26} />
      </button>
    {/if}

    <div class="stage">
      {#if !asset.web_viewable}
        <div class="unsupported">
          <strong>Preview unavailable</strong>
          <p>This original is safely stored, but this server cannot yet create a browser-compatible preview.</p>
          <a href={asset.original_url} download>Download original</a>
        </div>
      {:else if viewerShowsImage(asset)}
        <!-- `viewerShowsImage`, not an inline `media_type === 'image'`: callers
             must tag a grid tile only for assets that land in *this* branch, and
             sharing the predicate is what stops the two rules from drifting.
             Equivalent here — the branch above already excludes !web_viewable. -->
        {#if asset.thumbnail_url && !imgLoaded}
          <img class="preview" src={asset.thumbnail_url} alt="" aria-hidden="true" />
        {/if}
        <!-- Only this image is tagged: the blurred `preview` behind it must stay
             in the document so it can back-fill while the full view loads. At
             most one Viewer is mounted at a time, so the tag cannot collide
             with another Viewer — only with the grid tile it morphs from, which
             LibraryView clears inside the same flush. -->
        <img
          class:loaded={imgLoaded}
          style:view-transition-name={MORPH_NAME}
          src={asset.view_url}
          alt={asset.filename}
          on:load={() => (imgLoaded = true)}
        />
      {:else}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={asset.view_url} poster={asset.thumbnail_url} controls autoplay></video>
      {/if}
    </div>

    <aside class="info">
      <div class="head">
        <h2>{asset.filename}</h2>
        <p>{fileSize(asset.size_bytes)} · {asset.width}×{asset.height}</p>
        {#if asset.description}<p class="caption">{asset.description}</p>{/if}
      </div>
      <div class="actions">
        <button class="act" class:on={asset.favorite} type="button" on:click={() => dispatch('favorite', asset)}>
          <Star size={17} fill={asset.favorite ? 'currentColor' : 'none'} />
          {asset.favorite ? 'Favorited' : 'Favorite'}
        </button>
        {#if editable && !trashMode}
          <button class="act" type="button" on:click={startEdit}><Pencil size={16} /> Edit</button>
        {/if}
        {#if trashMode}
          <button class="act" type="button" on:click={() => dispatch('restore', asset)}>
            <RotateCcw size={17} /> Restore
          </button>
        {:else}
          <button class="act danger" type="button" on:click={() => dispatch('remove', asset)}>
            <Trash2 size={17} /> Delete
          </button>
        {/if}
      </div>
      {#if editing}
        <form class="edit" on:submit|preventDefault={saveEdit}>
          <label>Date<input type="datetime-local" bind:value={editDate} /></label>
          <label>Caption<input type="text" bind:value={editCaption} placeholder="Add a caption" /></label>
          <div class="gps">
            <label>Latitude<input type="text" inputmode="decimal" bind:value={editLat} placeholder="—" /></label>
            <label>Longitude<input type="text" inputmode="decimal" bind:value={editLon} placeholder="—" /></label>
          </div>
          <div class="edit-actions">
            <button type="button" class="ghost" on:click={() => (editing = false)}>Cancel</button>
            <button type="submit">Save</button>
          </div>
        </form>
      {:else}
        <dl>
          {#if asset.taken_at}
            <div><dt>Taken</dt><dd>{new Date(asset.taken_at).toLocaleString()}</dd></div>
          {/if}
          {#if asset.camera_model}
            <div><dt>Camera</dt><dd>{asset.camera_make} {asset.camera_model}</dd></div>
          {/if}
          {#if placeLabel(asset)}
            <div><dt>Place</dt><dd class="place"><MapPin size={13} /> {placeLabel(asset)}</dd></div>
          {/if}
          {#if asset.gps_lat && asset.gps_lon}
            <div><dt>GPS</dt><dd>{asset.gps_lat.toFixed(5)}, {asset.gps_lon.toFixed(5)}</dd></div>
          {/if}
        </dl>
      {/if}
      <a class="download" href={asset.original_url} download>
        <Download size={18} /> Download
      </a>
    </aside>
  </div>
{/if}

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    background: #111;
    color: #f7f3ec;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 999px;
    background: #ffffff22;
    color: #fff;
    cursor: pointer;
  }
  .close {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 32;
  }
  .nav {
    position: fixed;
    top: 50%;
    transform: translateY(-50%);
    z-index: 32;
  }
  .nav.left {
    left: 16px;
  }
  .nav.right {
    right: 356px;
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
    padding: 18px;
    overflow: hidden;
  }
  .stage img,
  .stage video {
    max-width: 100%;
    max-height: calc(100vh - 36px);
    object-fit: contain;
  }
  .stage img:not(.preview) {
    opacity: 0;
    transition: opacity 160ms ease;
  }
  .stage img.loaded {
    opacity: 1;
  }
  .stage .preview {
    position: absolute;
    width: min(100%, 1000px);
    height: min(100%, 1000px);
    filter: blur(20px);
    opacity: 0.4;
    transform: scale(1.05);
    object-fit: contain;
  }
  .unsupported {
    max-width: 420px;
    padding: 28px;
    border: 1px solid #ffffff2a;
    border-radius: 12px;
    background: #ffffff0d;
    text-align: center;
  }
  .unsupported strong { font-size: 18px; }
  .unsupported p { color: #c9c0b6; line-height: 1.45; }
  .unsupported a {
    display: inline-block;
    margin-top: 6px;
    padding: 10px 14px;
    border-radius: 8px;
    background: #f6f3ee;
    color: #171717;
    font-weight: 700;
    text-decoration: none;
  }
  .info {
    display: grid;
    align-content: start;
    gap: 18px;
    padding: 68px 22px 22px;
    border-left: 1px solid #ffffff1f;
    background: #1b1815;
    overflow: auto;
  }
  .head h2 {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: 18px;
  }
  .head p {
    margin: 4px 0 0;
    color: #c9c0b6;
  }
  .head .caption {
    margin-top: 8px;
    color: #e7e0d6;
    font-size: 15px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 1 1 auto;
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid #ffffff2a;
    border-radius: 8px;
    background: #ffffff12;
    color: #f7f3ec;
    cursor: pointer;
    font-size: 14px;
  }
  .edit {
    display: grid;
    gap: 10px;
  }
  .edit label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    text-transform: uppercase;
    color: #8f8579;
  }
  .edit input {
    height: 38px;
    padding: 0 10px;
    border: 1px solid #ffffff2a;
    border-radius: 8px;
    background: #ffffff10;
    color: #f7f3ec;
    font-size: 14px;
    text-transform: none;
  }
  .edit .gps {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .edit-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .edit-actions button {
    min-height: 40px;
    border: 0;
    border-radius: 8px;
    background: #f6f3ee;
    color: #171717;
    font-weight: 700;
    cursor: pointer;
  }
  .edit-actions .ghost {
    background: #ffffff14;
    color: #f7f3ec;
  }
  .act.on {
    color: #ffd35c;
    border-color: #ffd35c55;
  }
  .act.danger {
    color: #ff9a86;
  }
  dl {
    display: grid;
    gap: 12px;
    margin: 0;
  }
  dt {
    color: #8f8579;
    font-size: 12px;
    text-transform: uppercase;
  }
  dd {
    margin: 3px 0 0;
    color: #c9c0b6;
    overflow-wrap: anywhere;
  }
  dd.place {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .download {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-height: 42px;
    border-radius: 8px;
    background: #f6f3ee;
    color: #171717;
    text-decoration: none;
    font-weight: 700;
  }
  @media (max-width: 780px) {
    .viewer {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .nav.right {
      right: 16px;
    }
    .info {
      max-height: 44vh;
      padding: 18px;
      border-left: 0;
      border-top: 1px solid #ffffff1f;
    }
  }
</style>
