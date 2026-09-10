# Kuraki web UI

The SvelteKit single-page app that is Kuraki's browser experience — the timeline,
viewer, search, albums, places, and the operational dashboards. It is **not a
standalone app**: it is built into the Go server and talks to it over `/api`.

Its API types (`src/lib/api.gen.ts`) are **generated** from the server's OpenAPI
contract and CI fails on drift — see the generated-artifacts table in the
[root README](../README.md). What Kuraki does, told as user flows rather than
routes, is [USER_GUIDE.md](../USER_GUIDE.md).

## How it fits together

`npm run build` compiles this app with `@sveltejs/adapter-static` (SPA mode) into
`internal/httpapi/assets/`, which the Go binary embeds with `go:embed`. So the
production server ships the UI inside a single binary — there is no separate web
server to deploy: `kuraki serve` serves the UI and the API from one origin (in
Docker and standalone alike). The embedded UI boots under the server's strict CSP
via a per-request script nonce injected into `index.html`.

**Do not hand-edit `internal/httpapi/assets/` — it is generated. Edit source
here and rebuild.**

## Develop

From the **repo root** (recommended — runs the API and the UI together):

```sh
./scripts/dev.sh      # Go API on :39175 + Vite UI on :39176 (hot reload) — open :39176
```

Vite proxies `/api` to the Go server on `:39175`, so the UI needs that server
running. To run just the front end (assuming the API is already up on `:39175`):

```sh
cd web
npm install
npm run dev           # Vite dev server; use KURAKI_WEB_PORT to override its port
```

## Build

```sh
npm run build         # svelte-kit sync && vite build -> internal/httpapi/assets/
# from the repo root, equivalently:
make web
```

Build on **Node 24** (`.nvmrc`). Vite's content hashes are deterministic for identical
inputs, and "identical" includes the toolchain — another Node version rewrites every
hashed filename and produces a spurious full-tree diff in the committed assets.

`internal/httpapi/assets/` is **committed** (`go:embed` needs it in the tree), so a
change under `src/` is not landed until `make web` has been run and its diff staged.

After building, `./scripts/start.sh` (or `make start`) runs one production-like
Go process on `:39170` serving the embedded UI.

## PWA and resilient uploads

The production web app ships a manifest and a service worker. It caches the application shell only;
private `/api` and media responses remain network-only. Selected photos and videos are queued per
account in IndexedDB and resume after reconnect or reopen. Background Sync continues the queue when
the browser provides it; foreground retry is the universal fallback. A browser cannot automatically
read a phone's camera roll, so unattended camera backup remains a native-app feature.

## Design system

The UI has a deliberate identity built around **two registers** driven by
`src/lib/nav.ts`:

- **Kura** — an 8px rhythm, large settled headings, soft cards. Fronts the
  photo surfaces (timeline, viewer, albums, favorites, places).
- **Vault** — a 4px rhythm, micro-caps labels, tabular figures, flat hairline
  panels. Backs the operational surfaces (Overview, Devices, Activity, Settings,
  Trash, Duplicates).

Both registers set type in one family — the platform's own sans. The split is
rhythm, density and treatment, not typeface; hierarchy comes from size and
weight, which is what a photo app wants, since the type should seat the
photographs rather than compete with them. `e2e/registers.spec.ts` pins that.

The rule: **the register belongs to the page frame, never the photo components** —
`AssetGrid` and `Viewer` always render as Kura, because a photograph is a memory
even in Trash.

The palette lives in **`src/app.css`** as CSS custom properties mapped onto
shadcn-svelte's token names (renaming them would break every shadcn component).
`--stamp` (oxblood) is Kuraki's own mark, reserved for brand/active-nav/selection;
`--primary` stays ink so buttons never compete with the photographs.

## Gates

```sh
npm run check         # svelte-check — the ONLY type gate; `npm run build` does not typecheck
npm run test          # Vitest, pure logic in src/lib only
make e2e              # from the repo root: Playwright against a real seeded server
```

`make e2e` boots the **Go binary** against a throwaway seeded library, so it is the only
gate that sees runtime behaviour — a component that throws on mount is invisible to both
`build` and `svelte-check`. A console-error guard fails any test on `console.error` or an
uncaught page error, which is why a test that navigates and asserts nothing still earns
its keep. Note that a **running** `kuraki serve` keeps serving the assets it started
with: after `make web build`, restart it or you are testing the old UI.

### The contrast gate

`web/scripts/check-contrast.py` parses the tokens straight out of `src/app.css`
and fails if any pairing drops below WCAG AA. It is a **gate, not a doc** — run it
after any palette change:

```sh
python3 scripts/check-contrast.py
```

`src/app.css` is also the single source of truth for the **mobile** palette: the
Expo app generates its tokens from this file (`mobile/scripts/sync-tokens.mjs`),
and mobile CI fails if the two drift. Change a colour here and it flows to both
surfaces.

## Stack

- **SvelteKit** + `@sveltejs/adapter-static` (SPA, `go:embed`ed into the server)
- **Tailwind v4** + **shadcn-svelte** components (`src/lib/components/ui`)
- **No bundled fonts** — one system sans stack (`ui-sans-serif, system-ui, …`) for every register
- **@lucide/svelte** icons · native **View Transitions** for the grid→viewer morph

## Layout

```
web/
├── src/
│   ├── app.css                 # palette (source of truth for web + mobile), registers, motion tokens
│   ├── lib/
│   │   ├── nav.ts              # nav groups + per-route register; MOBILE_TABS
│   │   ├── api.ts · types.ts   # API client + shared types
│   │   ├── motion.ts           # transition/motion helpers
│   │   └── components/         # AssetGrid, Viewer, PageHeader, … + ui/ (shadcn)
│   └── routes/                 # timeline (search lives in its filter bar), albums, tags, favorites,
│                               #   memories, places, archive, hidden, duplicates, trash,
│                               #   settings/{overview,account,appearance,library,devices,activity,server,users}
├── scripts/check-contrast.py   # WCAG AA gate over app.css
└── svelte.config.js            # adapter-static -> internal/httpapi/assets
```
