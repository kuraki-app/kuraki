# Kuraki web UI

The SvelteKit single-page app that is Kuraki's browser experience — the timeline,
viewer, search, albums, places, and the operational dashboards. It is **not a
standalone app**: it is built into the Go server and talks to it over `/api`.

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
./scripts/dev.sh      # Go API on :3000 + Vite UI on :5173 (hot reload) — open :5173
```

Vite proxies `/api` to the Go server on `:3000`, so the UI needs that server
running. To run just the front end (assuming the API is already up on `:3000`):

```sh
cd web
npm install
npm run dev           # Vite dev server on :5173
```

## Build

```sh
npm run build         # svelte-kit sync && vite build -> internal/httpapi/assets/
# from the repo root, equivalently:
make web
```

After building, `./scripts/start.sh` (or `make start`) runs one production-like
Go process on `:3000` serving the embedded UI.

## Design system

The UI has a deliberate identity built around **two registers** driven by
`src/lib/nav.ts`:

- **Kura** — Fraunces display type, an 8px rhythm, warm paper surfaces. Fronts the
  photo surfaces (timeline, viewer, albums, favorites, places).
- **Vault** — Geist Mono for data, a 4px rhythm, flat hairline panels. Backs the
  operational surfaces (Overview, Devices, Activity, Settings, Trash, Duplicates).

The rule: **the register belongs to the page frame, never the photo components** —
`AssetGrid` and `Viewer` always render as Kura, because a photograph is a memory
even in Trash.

The palette lives in **`src/app.css`** as CSS custom properties mapped onto
shadcn-svelte's token names (renaming them would break every shadcn component).
`--stamp` (oxblood) is Kuraki's own mark, reserved for brand/active-nav/selection;
`--primary` stays ink so buttons never compete with the photographs.

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
- **Fraunces** (display) + **Geist** (body) + **Geist Mono** (Vault data), via `@fontsource-variable`
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
│   └── routes/                 # timeline, albums, places, trash, stats, devices, activity, settings, …
├── scripts/check-contrast.py   # WCAG AA gate over app.css
└── svelte.config.js            # adapter-static -> internal/httpapi/assets
```
