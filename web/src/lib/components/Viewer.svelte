<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { fly, type FlyParams } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    X,
    Download,
    Star,
    Trash2,
    ChevronLeft,
    ChevronRight,
    RotateCcw,
    MapPin,
    Pencil,
    Plus
  } from '@lucide/svelte';
  import type { Asset, Tag } from '$lib/types';
  import { api } from '$lib/api';
  import { fileSize, placeLabel } from '$lib/format';
  import { MORPH_NAME, viewerShowsImage, prefersReducedMotion } from '$lib/motion';
  import { trapFocus } from '$lib/focus';

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

  // ---- Tags -----------------------------------------------------------------
  //
  // The server has had tags since R2 and api.ts has carried the calls all
  // along, but nothing in the web client ever invoked them — tagging was
  // reachable only from the mobile app. The panel is the natural home: it is
  // already where a single asset's metadata is read and edited.
  let assetTags: Tag[] = [];
  let allTags: Tag[] = [];
  let tagPickerOpen = false;
  let tagsBusy = false;
  let loadedTagsFor = '';

  // Keyed on the id, so paging between assets refetches but re-rendering the
  // same one (a favourite toggle, an image load) does not.
  $: if (asset && asset.id !== loadedTagsFor) {
    loadedTagsFor = asset.id;
    tagPickerOpen = false;
    void loadTags(asset.id);
  }

  async function loadTags(id: string) {
    assetTags = [];
    try {
      const res = await api.assetTags(id);
      // Guard against a slow response for an asset the user has already paged
      // away from overwriting the current one's tags.
      if (loadedTagsFor === id) assetTags = res.tags;
    } catch {
      // A tag list that will not load must not take down the photo it belongs
      // to; the section simply stays empty.
    }
  }

  async function openTagPicker() {
    tagPickerOpen = !tagPickerOpen;
    if (!tagPickerOpen || allTags.length) return;
    try {
      const res = await api.tags();
      allTags = [...res.tags].sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      allTags = [];
    }
  }

  // The server has no add/remove for a single tag — it takes the full desired
  // set — so both directions go through one write.
  async function toggleTag(tag: Tag) {
    if (!asset || tagsBusy) return;
    const has = assetTags.some((t) => t.id === tag.id);
    const next = has ? assetTags.filter((t) => t.id !== tag.id) : [...assetTags, tag];
    tagsBusy = true;
    const before = assetTags;
    assetTags = next; // optimistic
    try {
      const res = await api.setAssetTags(asset.id, next.map((t) => t.id));
      assetTags = res.tags;
    } catch {
      assetTags = before;
    } finally {
      tagsBusy = false;
    }
  }

  const SLIDE_MS = 240; // --t-settle
  // cubicOut is a pure-deceleration curve like --e-kura (cubic-bezier(0.2,0,0,1));
  // Svelte transition easing must be a JS function, so this is a close JS
  // stand-in for the CSS token rather than a byte-identical reproduction.
  const SLIDE_EASE = cubicOut;
  const SLIDE_OFFSET = 56;

  // Slide direction, set only by `move()`. Starts `false` and flips true only
  // once the user actually navigates — this guarantees the very first render
  // of the viewer (the open morph, tagged via MORPH_NAME + view-transition on
  // the <img> below) never carries a competing WAAPI transform on the same
  // element. Belt-and-suspenders: Svelte's own local-transition rules already
  // skip `in:`/`out:` on a block's first-ever creation (and skip a nested
  // block's `out:` entirely when an ancestor — like this whole component — is
  // what's being torn down, per `pause_children` in
  // svelte/internal/client/reactivity/effects.js), so the close morph is safe
  // by construction too. `navigated` removes any dependence on that subtlety
  // for the open case specifically, since two elements racing for
  // view-transition-name is a silent, hard-to-detect failure.
  let navigated = false;
  let navDir: 1 | -1 = 1;

  function slideIn() {
    if (!navigated || prefersReducedMotion()) return { duration: 0 };
    return { x: navDir * SLIDE_OFFSET, duration: SLIDE_MS, easing: SLIDE_EASE };
  }
  function slideOut() {
    if (!navigated || prefersReducedMotion()) return { duration: 0 };
    return { x: -navDir * SLIDE_OFFSET, duration: SLIDE_MS, easing: SLIDE_EASE };
  }

  // The one place an outgoing frame lets go of MORPH_NAME. At most one element
  // may ever carry the name: two holders at a snapshot make the browser skip
  // the whole transition silently (see `morph` in motion.ts).
  //
  // The hazard: `{#key asset.id}` keeps the outgoing frame mounted for SLIDE_MS
  // while the incoming frame is already live, so both <img>s would hold the name
  // for that window. ArrowRight then Escape inside 240ms → `closeViewer()` →
  // `morph()` snapshots two holders → the signature interaction dies with a
  // console warning.
  //
  // Why a custom transition rather than `on:outrostart`: Svelte dispatches
  // `outrostart` from the `onfinish` of a zero-duration dummy WAAPI animation,
  // so it lands a frame *after* the key change. A transition function is invoked
  // synchronously inside the transition manager's `out()` (via `get_options()`,
  // during `pause_effect`), i.e. in the same flush that mounts the new frame —
  // so the window never opens at all. A frame is not a theoretical gap here: a
  // main thread busy decoding a full-resolution photo can drain several queued
  // keydowns before the next frame's callbacks run.
  //
  // Why not a reactive `asset.id === current` gate on the tag: Svelte pauses an
  // outroing block's effects, so an expression inside `{#key}` never re-runs on
  // the one frame that must release the name. (That same pausing is why the
  // outgoing frame keeps showing the *old* photo — it is load-bearing here.)
  //
  // Closing the viewer deliberately does NOT reach this: `out:` is local, and
  // `pause_children` only collects `is_global` transitions when an ancestor is
  // torn down, so the current frame keeps its name for the close morph.
  //
  // This invariant has been broken twice on this branch; it lives in one place.
  function slideOutFrame(node: Element, params: FlyParams) {
    // The blurred `.preview` never holds the name, so clearing it is a no-op.
    for (const img of node.querySelectorAll('img')) {
      img.style.removeProperty('view-transition-name');
    }
    return fly(node, params);
  }

  // --- Favorite star pop (spec §4.4 item 1) ---
  // Kura does not bounce anywhere except here: a small overshoot fires only
  // on the act of favoriting ON, never on un-favoriting and never on the
  // initial render of an already-favorited asset. Detected by comparing the
  // favorite flag across renders *for the same asset id* — a false→true
  // transition on the same id can only come from the user's own toggle,
  // since nothing else mutates it locally.
  let popStar = false;
  let popTimer: ReturnType<typeof setTimeout> | undefined;
  let prevAssetId: string | undefined;
  let prevFavorite: boolean | undefined;
  $: if (asset) {
    if (prevAssetId === asset.id && prevFavorite === false && asset.favorite === true) {
      popStar = false;
      popStar = true;
      clearTimeout(popTimer);
      popTimer = setTimeout(() => (popStar = false), 200);
    }
    prevAssetId = asset.id;
    prevFavorite = asset.favorite;
  }
  onDestroy(() => clearTimeout(popTimer));

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
  /** Clicking the star you are already on clears the rating — otherwise a
   *  1-star rating would be impossible to undo without an extra control. */
  function setRating(n: number) {
    dispatch('patch', { id: asset.id, rating: (asset.rating ?? 0) === n ? 0 : n });
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
    if (n >= 0 && n < assets.length) {
      navDir = delta > 0 ? 1 : -1;
      navigated = true;
      dispatch('navigate', n);
    }
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowLeft') move(-1);
  }
</script>

<svelte:window on:keydown={key} />

{#if asset}
  <!-- tabindex allows the container itself to hold focus if a photo-only
       viewer ever has no focusable control inside it. -->
  <div class="viewer" role="dialog" aria-modal="true" aria-label="Photo viewer" tabindex="-1" use:trapFocus>
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
      <!-- Keyed on asset id so next/prev slides directionally. This transition
           is local (no `|global`), so per Svelte's own semantics it only fires
           when *this* key block reacts to its own key changing — i.e. on
           navigation within an already-open viewer — never on this block's
           first-ever creation (opening) nor when an ancestor unmounts it
           (closing). `navigated` above additionally hard-guarantees the open
           case regardless of that. Both guards exist because the morph's
           `view-transition-name` on the <img> below must never share a
           snapshot with a second animated holder — two holders abort the
           transition silently. They cover the *incoming* frame; the frame this
           block leaves behind is covered by `slideOutFrame`, which releases the
           name in the same flush the key changes. -->
      {#key asset.id}
        <div class="frame" in:fly={slideIn()} out:slideOutFrame={slideOut()}>
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
                 with another Viewer. It can collide with exactly two other things,
                 both handled: the grid tile it morphs from (LibraryView clears that
                 inside the same flush) and this component's own outgoing frame
                 during a slide (`slideOutFrame` above strips it synchronously). -->
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
      {/key}
    </div>

    <aside class="info">
      <div class="head">
        <h2>{asset.filename}</h2>
        <p>{fileSize(asset.size_bytes)} · {asset.width}×{asset.height}</p>
        {#if asset.description}<p class="caption">{asset.description}</p>{/if}
      </div>
      {#if editable && !trashMode}
        <!-- Rating was filterable and displayed long before anything could set
             it — only the importer and the Immich migration ever wrote the
             column. It lives here rather than inside the edit form because a
             rating is a one-click judgement, not a field you open a form to
             change. Clicking the current rating clears it. -->
        <div class="rating" role="group" aria-label="Rating">
          {#each [1, 2, 3, 4, 5] as n (n)}
            <button
              type="button"
              class="star"
              class:on={(asset.rating ?? 0) >= n}
              aria-label={n === 1 ? '1 star' : `${n} stars`}
              aria-pressed={(asset.rating ?? 0) === n}
              on:click={() => setRating(n)}
            >
              <Star size={16} fill={(asset.rating ?? 0) >= n ? 'currentColor' : 'none'} />
            </button>
          {/each}
        </div>
      {/if}
      <div class="actions">
        <button class="act" class:on={asset.favorite} type="button" on:click={() => dispatch('favorite', asset)}>
          <span class="star-icon" class:pop={popStar}>
            <Star size={17} fill={asset.favorite ? 'currentColor' : 'none'} />
          </span>
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

        <section class="tags">
          <div class="tags-head">
            <h3>Tags</h3>
            {#if editable && !trashMode}
              <button type="button" class="add" on:click={openTagPicker} aria-expanded={tagPickerOpen}>
                <Plus size={14} /> {tagPickerOpen ? 'Done' : 'Edit'}
              </button>
            {/if}
          </div>
          {#if assetTags.length}
            <div class="chips">
              {#each assetTags as tag (tag.id)}
                <a class="chip" href="/tags/{tag.id}?name={encodeURIComponent(tag.name)}">{tag.name}</a>
              {/each}
            </div>
          {:else if !tagPickerOpen}
            <p class="none">No tags yet.</p>
          {/if}
          {#if tagPickerOpen}
            <div class="picker">
              {#if allTags.length === 0}
                <p class="none">No tags exist yet — create one on the Tags page.</p>
              {:else}
                {#each allTags as tag (tag.id)}
                  <button
                    type="button"
                    class="pick"
                    class:on={assetTags.some((t) => t.id === tag.id)}
                    disabled={tagsBusy}
                    on:click={() => toggleTag(tag)}
                  >
                    {tag.name}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </section>
      {/if}
      <a class="download" href={asset.original_url} download>
        <Download size={18} /> Download
      </a>
    </aside>
  </div>
{/if}

<style>
  .tags {
    padding-top: 4px;
  }
  .tags-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tags h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.6;
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid #ffffff2e;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .chips,
  .picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .chip {
    padding: 3px 10px;
    border: 1px solid #ffffff2e;
    border-radius: 999px;
    font-size: 12px;
    color: inherit;
    text-decoration: none;
  }
  .chip:hover {
    background: #ffffff1a;
  }
  .pick {
    padding: 3px 10px;
    border: 1px dashed #ffffff3d;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .pick.on {
    border-style: solid;
    background: #ffffff26;
  }
  .pick:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .none {
    margin: 6px 0 0;
    font-size: 12px;
    opacity: 0.6;
  }
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
  /* `grid-area: 1 / 1` pins both the outgoing and incoming frame to the same
   * cell during a slide — without it the implicit grid would stack them into
   * separate rows and the transition would jump the layout instead of
   * overlapping. */
  .frame {
    grid-area: 1 / 1;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
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
  .rating {
    display: flex;
    gap: 2px;
    margin-bottom: 10px;
  }
  .star {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    /* This panel sits on the constant-in-both-themes --chrome surface, so it
     * uses the chrome tokens rather than --foreground, like every other control
     * in the viewer. Unrated stars are --chrome-muted; a set star goes to full
     * --chrome-text. Deliberately NOT --stamp-foreground, which is the colour of
     * text ON the stamp fill and is near-black in dark mode — invisible here. */
    color: var(--chrome-muted);
    cursor: pointer;
  }
  .star:hover {
    background: var(--chrome-fill);
  }
  .star.on {
    color: var(--chrome-text);
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
  .star-icon {
    display: inline-flex;
  }
  /* The single overshoot in the app: fires only on the act of favoriting ON
   * (gated in script, not here). A plain CSS `animation`, not a Svelte
   * transition, so it is automatically covered by the global
   * `prefers-reduced-motion` rule in app.css (animation-duration collapses to
   * ~0 and iteration-count to 1) — no JS gate needed for this one. */
  .star-icon.pop {
    animation: star-pop 180ms var(--e-kura);
  }
  @keyframes star-pop {
    0% {
      transform: scale(1);
    }
    45% {
      transform: scale(1.32);
    }
    100% {
      transform: scale(1);
    }
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
