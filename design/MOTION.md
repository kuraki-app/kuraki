# Kuraki motion contract

Motion confirms an action or explains a state change. It must not delay navigation, compete with
photos, or run merely because something is visible.

## Patterns

| Pattern | Use | Motion |
|---|---|---|
| Press | Buttons, settings rows, cards | Settle to `0.97` scale, then release |
| Lift | Pointer hover on durable cards | Rise `2px`; never move surrounding layout |
| Enter | Upload status and compact browse cards | Fade and travel `6px` once |
| Reveal | Optional setting help | Expand over the crisp timing step |
| Progress | Upload and backup completion | Interpolate the existing bar; never animate the number |
| Continuity | Photo tile into viewer | Keep the existing shared-element morph |

Use `80ms` for confirmation, `140ms` for controls and reveals, `240ms` for settling, and `320ms`
only for the photo-viewer morph. Staggered groups stop after six items and stay below `150ms` total.

## Guardrails

- Respect the system Reduce Motion preference. Keep the final state and remove travel, scale,
  shimmer, and stagger.
- Animate `transform` and `opacity` where possible. Progress width is the deliberate exception.
- Touch feedback must begin on press-in, not after the action completes.
- Hover motion runs only for fine pointers. A touch device must never depend on hover.
- Do not loop except while work is genuinely in progress.
