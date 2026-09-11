# Kuraki interface contract

Web and mobile share identity and information architecture, while controls stay native to each
platform. `tokens.json` is the source for color, spacing, radii, type, and width classes; run
`npm run sync-design` from `web/` or `mobile/` after changing it.

## Primary destinations

1. **Photos** — the chronological library and archive.
2. **Collections** — Favorites, Albums, On this day, Places, and Tags.
3. **Settings** — backup, connection, preferences, maintenance, and Advanced.
4. **Search** — query and filters without crowding Photos.

## Page patterns

- **Canvas** — edge-to-edge media grids and maps. Controls float in platform chrome; content is not
  constrained to a reading width.
- **Collection** — a small browse group followed by visual content. Use persistent cards or rows,
  never collapsed sections.
- **Grouped page** — settings and operational controls in titled, always-visible groups. Show only
  the setting name and current value; longer help belongs behind an info action. Rare or diagnostic
  controls go in Advanced.
- **Detail** — one object, one native back action, and actions in the platform toolbar.

## Responsive rules

- Compact: up to 599px, 16px gutters, one-column grouped pages, two-column album cards.
- Medium: 600–839px, 20px gutters, three-column album cards.
- Expanded: 840px and above, 24px gutters, four-column album cards and an 800px readable measure.
- Media canvases may exceed the readable measure. Text/settings pages may not.
- Every interactive control keeps at least a 44px touch target and respects safe-area insets.
