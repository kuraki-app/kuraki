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
    MapPin
  } from '@lucide/svelte';
  import type { Asset } from '$lib/types';
  import { fileSize, placeLabel } from '$lib/format';

  export let assets: Asset[] = [];
  export let index = 0;
  export let trashMode = false;

  const dispatch = createEventDispatcher();
  $: asset = assets[index];
  let imgLoaded = false;
  $: if (index >= 0) imgLoaded = false;

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
      {#if asset.media_type === 'image'}
        {#if asset.thumbnail_url && !imgLoaded}
          <img class="preview" src={asset.thumbnail_url} alt="" aria-hidden="true" />
        {/if}
        <img
          class:loaded={imgLoaded}
          src={asset.original_url}
          alt={asset.filename}
          on:load={() => (imgLoaded = true)}
        />
      {:else}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={asset.original_url} poster={asset.thumbnail_url} controls autoplay></video>
      {/if}
    </div>

    <aside class="info">
      <div class="head">
        <h2>{asset.filename}</h2>
        <p>{fileSize(asset.size_bytes)} · {asset.width}×{asset.height}</p>
      </div>
      <div class="actions">
        <button class="act" class:on={asset.favorite} type="button" on:click={() => dispatch('favorite', asset)}>
          <Star size={17} fill={asset.favorite ? 'currentColor' : 'none'} />
          {asset.favorite ? 'Favorited' : 'Favorite'}
        </button>
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
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 40px;
    border: 1px solid #ffffff2a;
    border-radius: 8px;
    background: #ffffff12;
    color: #f7f3ec;
    cursor: pointer;
    font-size: 14px;
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
