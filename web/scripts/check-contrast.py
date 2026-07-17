#!/usr/bin/env python3
"""WCAG 2.1 contrast gate for the Kuraki web palette.

Parses the real token values out of src/app.css, so this verifies what actually
ships rather than a copy that can drift. Exits non-zero on any AA failure.

Usage: python3 web/scripts/check-contrast.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CSS = Path(__file__).resolve().parents[1] / "src" / "app.css"

# (foreground, background, minimum, description)
# 4.5 = AA body text. 3.0 = AA non-text contrast (1.4.11) for UI components.
CHECKS: list[tuple[str, str, float, str]] = [
    ("foreground", "background", 4.5, "body text on page"),
    ("foreground", "card", 4.5, "body text on card"),
    ("text-dim", "background", 4.5, "secondary text on page"),
    ("text-dim", "card", 4.5, "secondary text on card"),
    ("text-faint", "background", 4.5, "faint/meta text on page"),
    ("text-faint", "card", 4.5, "faint/meta text on card"),
    ("muted-foreground", "background", 4.5, "muted text on page"),
    ("muted-foreground", "card", 4.5, "muted text on card"),
    ("primary-foreground", "primary", 4.5, "label on primary fill"),
    ("destructive", "background", 4.5, "danger text"),
    ("ok", "background", 4.5, "success text"),
    ("warn", "background", 4.5, "warning text"),
    ("info", "background", 4.5, "info text"),
    # UI components: a boundary that tells you where to click must be visible.
    ("ring", "background", 3.0, "focus ring vs page"),
    ("ring", "card", 3.0, "focus ring vs card"),
    ("input", "background", 3.0, "control boundary vs page"),
    ("input", "card", 3.0, "control boundary vs card"),
    ("stamp", "background", 4.5, "stamp accent on page"),
    ("stamp", "card", 4.5, "stamp accent on card"),
    ("stamp-foreground", "stamp", 4.5, "label on stamp fill"),
]

# WCAG 1.4.11 covers UI components and meaningful graphics, not decoration.
# A divider between paragraphs conveys nothing, so it is exempt: reported for
# information, never gated. Keeping it separate from `input` (which does gate)
# is what keeps that distinction honest.
DECORATIVE: list[tuple[str, str, str]] = [
    ("border", "background", "hairline divider (decorative, exempt)"),
]


def srgb_to_lin(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hexstr: str) -> float:
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * srgb_to_lin(r) + 0.7152 * srgb_to_lin(g) + 0.0722 * srgb_to_lin(b)


def ratio(fg: str, bg: str) -> float:
    a, b = luminance(fg), luminance(bg)
    lo, hi = min(a, b), max(a, b)
    return (hi + 0.05) / (lo + 0.05)


def parse_blocks(css: str, selector: str) -> dict[str, str]:
    """Merge `--token: #hex;` pairs from every `selector { ... }` block.

    app.css splits its dark theme across more than one `.dark` block, so every
    match has to be merged rather than taking the first.
    """
    tokens: dict[str, str] = {}
    pattern = re.escape(selector) + r"\s*\{(.*?)\n\}"
    for block in re.finditer(pattern, css, re.S):
        tokens.update(re.findall(r"--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;", block.group(1)))
    return tokens


def main() -> int:
    if not CSS.exists():
        print(f"check-contrast: cannot find {CSS}", file=sys.stderr)
        return 2

    css = CSS.read_text()
    light = parse_blocks(css, ":root")
    dark = {**light, **parse_blocks(css, ".dark")}
    if not light:
        print(f"check-contrast: no :root tokens parsed from {CSS}", file=sys.stderr)
        return 2

    failures = 0
    missing = 0
    for name, theme in (("LIGHT", light), ("DARK", dark)):
        print(f"\n=== {name} ===")
        for fg, bg, minimum, label in CHECKS:
            if fg not in theme or bg not in theme:
                absent = fg if fg not in theme else bg
                print(f"  MISS  --{absent} not defined{'':18} {label}")
                missing += 1
                continue
            r = ratio(theme[fg], theme[bg])
            ok = r >= minimum
            failures += 0 if ok else 1
            status = "PASS" if ok else "FAIL"
            print(f"  {status}  {r:5.2f}:1  (need {minimum})  {label:32} {fg} on {bg}")
        for fg, bg, label in DECORATIVE:
            if fg in theme and bg in theme:
                print(f"  ....  {ratio(theme[fg], theme[bg]):5.2f}:1  (exempt   )  {label}")

    print()
    if failures or missing:
        print(f"FAILED: {failures} contrast failure(s), {missing} missing token(s)")
        return 1
    print("All contrast checks pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
