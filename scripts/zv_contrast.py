"""Measure WCAG contrast for ZetaVote colour roles.

The acceptance bar for the tabulating-card palette is measured, never eyeballed,
so this exists as a runnable check rather than a spreadsheet somebody maintains.

Two jobs:

    python3 scripts/zv_contrast.py tokens     # the whole token table, both themes
    python3 scripts/zv_contrast.py oklch 0.72 0.13 198   # one colour, as hex
    python3 scripts/zv_contrast.py ratio "#a3a3a3" "#131313"

`tokens` resolves each semantic role against the surfaces it is actually used
on — a role is never measured against white, and never against a surface it does
not sit on. Card stock is its own surface with its own ink ramp, and a hole is a
non-text mark, so the bar for it is 3:1 while a punched label's is 4.5:1. Exits
non-zero if any pair misses its bar.

The hex tables below are the resolved OKLCH values in src/theme.css. A ramp step
is not considered shipped until it appears here with a pair that clears.

OKLCH is converted through OKLab to linear sRGB here rather than trusted to a
colour library: the conversion is the thing being checked, and the project ships
no dependency that does it.
"""

from __future__ import annotations

import math
import sys

# WCAG 2.1 relative luminance thresholds.
BODY = 4.5
LARGE = 3.0


def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c: float) -> float:
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def oklch_to_hex(lightness: float, chroma: float, hue_deg: float) -> str:
    """OKLCH -> sRGB hex, with gamut clipping so a bad ramp step fails loudly."""
    h = hue_deg * math.pi / 180.0
    a = chroma * math.cos(h)
    b = chroma * math.sin(h)

    l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
    m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
    s_ = lightness - 0.0894841775 * a - 1.2914855480 * b

    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3

    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    rgb = [_linear_to_srgb(v) for v in (r, g, bl)]
    if any(v < -0.001 or v > 1.001 for v in rgb):
        print(
            f"  ! out of sRGB gamut: oklch({lightness} {chroma} {hue_deg})",
            file=sys.stderr,
        )
    return "#" + "".join(
        f"{round(min(1.0, max(0.0, v)) * 255):02x}" for v in rgb
    )


def hex_to_rgb(value: str) -> tuple[float, float, float]:
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6:
        raise ValueError(f"not a hex colour: {value}")
    return tuple(int(v[i : i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(value: str) -> float:
    r, g, b = (_srgb_to_linear(c) for c in hex_to_rgb(value))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# ---------------------------------------------------------------------------
# The role table. Each entry is (role, surface it sits on, bar). Surfaces are
# named, not inlined, so a surface change is a one-line edit here.
# ---------------------------------------------------------------------------

DARK = {
    "bg-base": "#0e1624",
    "surface": "#182030",
    "surface-hover": "#222b3c",
    "sunken": "#0b1320",
    "tray": "#060d1a",
    "ink": "#eff4f8",
    "ink-muted": "#b3c0ca",
    "ink-faint": "#94a0aa",
    "line": "#2d3645",
    "line-strong": "#697686",
    "line-input": "#748192",
    "card": "#e9f1f8",
    "card-ink": "#172135",
    "card-muted": "#434d61",
    "card-line": "#748192",
    "punch": "#5fbcf4",
    "punch-ink": "#a6d8fa",
    "punch-bg": "#092a3c",
    "punch-mark": "#23709b",
    "punch-text": "#225b7c",
    "seal": "#f2716a",
    "seal-ink": "#fda19a",
    "seal-bg": "#391917",
    "seal-mark": "#c43f3e",
    "seal-text": "#a92227",
    "fill": "#5fbcf4",
    "fill-ink": "#0e1624",
}

LIGHT = {
    "bg-base": "#f0f4f8",
    "surface": "#fcfdff",
    "surface-hover": "#e9edf2",
    "sunken": "#ffffff",
    "tray": "#e3e8ee",
    "ink": "#172135",
    "ink-muted": "#4c5666",
    "ink-faint": "#5a6475",
    "line": "#d9dfe5",
    "line-strong": "#78818c",
    "line-input": "#717a85",
    "card": "#fcfdff",
    "card-ink": "#172135",
    "card-muted": "#434d61",
    "card-line": "#7e8792",
    "punch": "#1f6a96",
    "punch-ink": "#0d5279",
    "punch-bg": "#daeefe",
    "punch-mark": "#347ca9",
    "punch-text": "#1f6a96",
    "seal": "#ac312c",
    "seal-ink": "#901e1c",
    "seal-bg": "#ffe4e0",
    "seal-mark": "#c0453d",
    "seal-text": "#ac312c",
    "fill": "#5fbcf4",
    "fill-ink": "#0e1624",
}

# (foreground role, background role, minimum ratio, what it is)
CHECKS = [
    ("ink", "bg-base", BODY, "body text on the page"),
    ("ink", "surface", BODY, "body text on a card"),
    ("ink", "surface-hover", BODY, "body text on hover"),
    ("ink", "sunken", BODY, "body text in an input"),
    ("ink", "tray", BODY, "body text in a tray well"),
    ("ink-muted", "surface", BODY, "muted text on a card"),
    ("ink-muted", "bg-base", BODY, "muted text on the page"),
    ("ink-muted", "tray", BODY, "muted text in a tray well"),
    ("ink-faint", "surface", BODY, "apparatus text on a card"),
    ("ink-faint", "bg-base", BODY, "apparatus text on the page"),
    ("ink-faint", "tray", BODY, "apparatus text in a tray well"),
    ("line-input", "sunken", LARGE, "input border"),
    ("line-input", "surface", LARGE, "input border on a card"),
    ("line-strong", "surface", LARGE, "strong rule and scrollbar thumb"),
    ("line-strong", "bg-base", LARGE, "strong rule on the page"),
    ("line-strong", "tray", LARGE, "the tray's edge"),
    ("punch", "surface", BODY, "punch signal text on a card"),
    ("punch", "bg-base", BODY, "punch signal text on the page"),
    ("punch-ink", "punch-bg", BODY, "punch signal on its own fill"),
    ("punch-mark", "card", LARGE, "a punched hole on card stock"),
    ("punch-text", "card", BODY, "a punched label on card stock"),
    ("punch-mark", "tray", LARGE, "a punched hole in a tray well"),
    ("seal", "surface", BODY, "seal signal text on a card"),
    ("seal", "bg-base", BODY, "seal signal text on the page"),
    ("seal-ink", "seal-bg", BODY, "seal signal on its own fill"),
    ("seal-mark", "card", LARGE, "the seal mark on card stock"),
    ("seal-text", "card", BODY, "the seal label on card stock"),
    ("seal-mark", "tray", LARGE, "the seal mark in a tray well"),
    ("fill-ink", "fill", BODY, "the punch fill's own label"),
    ("card-ink", "card", BODY, "printed ink on card stock"),
    ("card-muted", "card", BODY, "printed muted ink on card stock"),
    ("card-line", "card", LARGE, "a field rule on card stock"),
]


def report_tokens() -> int:
    failures = 0
    for theme_name, theme in (("dark", DARK), ("light", LIGHT)):
        print(f"\n{theme_name}")
        print(f"  {'role':<12} {'on':<10} {'ratio':>7}  {'bar':>4}  what")
        for fg, bg, bar, what in CHECKS:
            ratio = contrast(theme[fg], theme[bg])
            ok = ratio >= bar
            if not ok:
                failures += 1
            print(
                f"  {fg:<12} {bg:<10} {ratio:>6.2f}:1  {bar:>4}  "
                f"{'ok' if ok else 'FAIL'}  {what}"
            )
    if failures:
        print(f"\n{failures} pair(s) below the bar")
    else:
        print("\nall pairs at or above the bar")
    return 1 if failures else 0


def report_one(lightness: float, chroma: float, hue: float) -> int:
    value = oklch_to_hex(lightness, chroma, hue)
    print(f"oklch({lightness} {chroma} {hue}) = {value}")
    print(f"  on white  {contrast(value, '#ffffff'):.2f}:1")
    print(f"  on black  {contrast(value, '#000000'):.2f}:1")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] == "tokens":
        return report_tokens()
    if args[0] == "oklch" and len(args) == 4:
        return report_one(*(float(a) for a in args[1:]))
    if args[0] == "ratio" and len(args) == 3:
        print(f"{contrast(args[1], args[2]):.2f}:1")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())