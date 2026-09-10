# Gallery redesign and platform parity — 2026-09-09

## Direction and initial suggestions

Use the supplied Ente reference for the memories rail and date-led photo grid,
and the dark gallery reference for quiet controls, rounded collection covers and
an immersive viewer. Kuraki retains its neutral light/dark palettes and oxblood
accent. Photos use 8px corners, collections use 12px, and default gutters are 4px.
Mobile retains platform-native tabs, headers, back navigation and selection actions.
These references guide design; their advertisements, personal names and depicted
features are not product requirements or instructions.

Three high-value improvements: surface memories within the timeline, make album
covers recognizable from their contents, and show the cached thumbnail immediately
while the full viewer media loads. The codebase supplies the stack and API answers:
Go/chi, SQLite, SvelteKit, Expo/React Native, generated OpenAPI types, authenticated
REST media endpoints, SSE wakeups on Web and a cursor-based change feed on Mobile.
No new API transport, schema, runtime library, or ML service is needed for this work.

## Gap audit and implementation

| Surface | Audited gap | Change |
|---|---|---|
| Gallery | Square, tightly packed tiles; Web and Mobile grouping options differed | Shared geometry, rounded tiles, small gutters, counted Web headings and Mobile day grouping; saved preferences remain honored |
| Memories | Mobile-only rail; two separate date/cover policies would drift | Web rail using the same pure year grouping as Mobile; shared dimensions and See all entry points |
| Albums | Web ignored Go's cover IDs and rendered folder icons | Web adopts Mobile's single-cover/four-cover mosaic policy; lazy authenticated thumbnails; matching square covers |
| Viewer | Web details permanently occupied phone space; Mobile waited on full images | Web details toggle, phone overlay sheet, fixed favorite/details controls, thumbnail-first rendering on both clients |
| Gestures | Mobile supported zoom/swipe; Web supported only keyboard/buttons | Web pointer pinch, double-click zoom, pan, horizontal swipe and downward dismiss; native gestures retained |
| Large groups | Web virtualized entire days/months, potentially mounting thousands of tiles | Six-row windows with exact gutter-aware spacer heights; focus and morph targets stay mounted |
| Mobile rendering | Screen width captured once; stale drag boxes; oversized pager window | Measure actual container on rotation, release unmounted hit targets, bounded list/pager windows, indexed viewer lookup |
| Playback | Mobile always requested originals, including incompatible codecs | Authenticated server-certified preview first; only active video loads/plays; unsupported playback is explicit |
| Delivery | Expired media had no cache validators | Conditional GET/HEAD via ETag/Last-Modified, private credential-varying cache, retained byte-range streaming |

Geometry originates in `web/src/app.css`. `mobile/scripts/sync-tokens.mjs` generates
Mobile palette tokens and `shared/gallery-tokens.ts`; both clients use the shared
memory and album-cover functions. Metro watches `shared/`; Docker copies it before
building the Web client. Storage reads still go through `storage.Storage`; optional
file metadata enables validators without enlarging that interface or reading a whole
media file into memory. Derivative URLs retain their existing one-week TTL.

## Development roadmap by priority

1. **Priority 1 — common gallery language and existing flows.** Ship the gallery,
   memories, album and viewer changes above. Run every existing Web regression test,
   not only screenshot checks. Validate portrait/landscape native layouts, VoiceOver,
   TalkBack, reduced motion, pinch and interrupted loads on actual supported devices.
   Treat remaining functional differences below as explicit work, not completed parity.
2. **Priority 2 — bounded work and delivery.** Verify 10,000 items in one month keep
   mounted tiles bounded, maintain scroll height after loading settles and survive
   resizing. Verify media 304, HEAD, 206 and invalid-range behavior. Next measure
   real 10k/50k libraries on a low-resource server: p95 page API latency, cold/warm
   viewer latency, dropped frames, device memory and slow-network recovery. Target
   p95 page API under 200ms on the agreed LAN hardware and responsive scrolling
   without sustained frames over 32ms; these are acceptance targets, not measured claims.
3. **Priority 3 — gated enhancements.** Existing Places, tags, saved searches,
   archive, stacks, duplicates and backup remain available. Close Mobile editing,
   search and export gaps first. Then consider an opt-in backup-health summary
   reusing existing status APIs, or saved-search shortcuts on both home screens.
   Face recognition requires a separate opt-in model/storage/CPU budget. Shared
   links require an explicit access/expiry/revocation design. Both remain gated on
   parity and capacity evidence and the repository's parked-sharing decision.

## Functional coverage and remaining differences

| Capability | Web | Mobile |
|---|---|---|
| Timeline, favorites, albums, memories, Places | Existing flows retained; covers/rail improved | Existing flows retained; day grouping added |
| Selection, trash/restore, archive, tags, duplicates | Retained | Retained |
| Search/filtering | Full server filter language and saved searches | Existing search preserved; full filter/saved-search parity remains to implement |
| Caption/date/GPS/rating edits | Retained | Metadata display and tags retained; full metadata editing remains to implement |
| Export and original download | Retained | Full export/download workflow parity remains to implement |
| Background camera backup and offline writes | Browser import and live sync | Existing native backup, local mirror and durable mutation queue retained |
| Server administration | Owner/admin settings retained | Existing device settings retained; server administration remains on Web |

**This change does not establish 100% functional parity or certify a production
release.** It closes the audited presentation and rendering gaps without removing
existing capabilities. Additional features stay gated on the remaining work above.

## Verification

The subsequent whole-Web and Settings pass is recorded in
[WEB_REDESIGN.md](./WEB_REDESIGN.md), including the expanded 107-test Chromium
suite. The results below describe the preceding gallery/Mobile work.

Verified: Web typecheck/build, 21 Web unit tests, 269 Mobile unit tests, Mobile
TypeScript and lint, Go vet and the complete Go race suite. The full Chromium
suite passes 98 tests covering existing routes, editing, selection, albums,
keyboard/focus, reduced motion, overflow and the added parity checks. Color
contrast passes in both palettes. Light and dark phone Web layouts were also
captured and visually inspected; the dark-mode rail check passes. An iOS production export completed successfully.

The 10,000-photo single-month fixture mounted 168 tiles at each of three desktop
scroll positions and 54 after resizing to 390px; scroll height stayed at 207,567px
before resizing. This is a bounded-DOM result, not a frame-rate claim.

The simulator's accessibility tree was available, but its computer-use tool
reported screenshots unavailable and did not reliably act on the UI. Native
visual/gesture verification therefore remains pending; iOS export is the native
build evidence from this pass. The 10k browser fixture tests
rendering capacity with a synthetic list and real seeded thumbnails; it is not a
10k-database or network-latency benchmark. Native bundle success is not native visual,
gesture, accessibility or background-execution certification.

Implementation references: [Expo Image](https://docs.expo.dev/versions/v56.0.0/sdk/image/),
[React Native list tuning](https://reactnative.dev/docs/optimizing-flatlist-configuration),
and [responsive dimensions](https://reactnative.dev/docs/usewindowdimensions).
