# Web redesign and Settings reliability

The September 10, 2026 Web pass extends the gallery work in [UI_PARITY.md](./UI_PARITY.md)
to the application shell and operational pages. The existing Go REST routes,
session authentication, embedded distribution, and library workflows are retained.
No new dependency or database migration was needed.

## Changes and evidence

| Area | Previous gap | Implemented behavior |
|---|---|---|
| Navigation | Sidebar footer disappeared below short desktop windows | Scrollable navigation with a fixed, reachable Upload / Theme / Sign out footer; familiar Photos entry point |
| Mobile navigation | Keyboard focus could leave the More sheet | Explicit close action, contained Tab navigation, focus restored on dismissal |
| Settings navigation | Phone rail clipped sections offscreen | Labelled native selector; grouped desktop navigation; role-aware administration |
| Settings layout | Inconsistent forms, tight rows, oversized corners | Shared 8–12px geometry, readable subtitles, grouped cards, container-responsive controls |
| Overview | One failed request blanked the entire page | Independent statistics, integrity and backup loads with per-resource retry |
| Draft edits | Saving one field reset edits in unrelated fields | Preserve unrelated drafts, including unsaved secrets; serialize saves; disable the field while saving |
| OCR | Rejected toggle kept displaying the attempted value | Restore the saved state on rejection; expose pressed state accessibly |
| Activity | Poll failures repeatedly toasted and hid successful results | Preserve successful resources, show an inline recovery state, prevent overlapping polls |
| Devices / accounts / external libraries | Failed initial loads lacked a persistent recovery action | Inline retry controls |
| Backup status | Hardcoded 36-hour deadline could flag weekly backups as overdue | Show actual run state and age; no invented schedule |
| Authentication / imports | Sign-out rejection was unhandled; import polling could silently stop | Recoverable sign-out error; explicit Activity handoff if import tracking loses contact; prevent overlapping uploads |
| Collections | Tags used a narrow administrative list; duplicate toolbar overlapped phone tabs | Responsive tag cards and a bounded duplicate toolbar above navigation |

Gallery, albums, favorites, memories, Places, tags, archive, hidden, duplicates,
trash, authentication and every Settings section inherit the same header and
control styling. Photo grids retain their available width; Settings keeps a
bounded reading measure. Existing native Mobile tabs remain native.

## Verification

The initial browser regressions reproduced all three defects before fixes:
blank overview, discarded draft, and inaccessible sidebar footer.

Final checks passed: 107 Chromium browser tests, 21 Web unit tests, Svelte
checking with zero errors and zero warnings, production Web and pure-Go builds,
Go vet and the complete Go race suite. Both palette contrast checks pass.
The final browser run had no unexpected console warnings/errors. Desktop and
phone Settings screenshots were visually inspected in both themes; phone
statistics explicitly remain two columns.
The browser suite covers existing library workflows and adds failed-request
recovery, draft retention, rejected OCR writes, regular-account navigation,
keyboard containment, and all eight Settings sections at 1440, 390 and 320px
in light and dark themes. Screenshots are captured after finite animations
complete. The shared console guard now checks warnings as well as errors and
uncaught exceptions. Existing explicitly documented allowances for unavailable
map tiles and missing thumbnails remain; deliberately injected HTTP failures
are allowed only within the tests that create them.

These checks establish the tested Chromium behavior, not an absence of every
possible defect. Safari/Firefox, native gestures and physical-device background
execution remain separate release-certification work. Large-library browser
fixtures bound mounted media elements; they do not measure real-library API
latency or end-to-end streaming throughput.
