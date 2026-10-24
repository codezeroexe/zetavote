"""Capture the ZetaVote app at both widths, in both themes, for review.

Not a test. It drives the dev server that is already running on
http://localhost:5173 and writes PNGs into .impeccable/review/.

    python3 scripts/capture_screenshots.py                 # every shot it can
    python3 scripts/capture_screenshots.py --only login    # one surface
    python3 scripts/capture_screenshots.py --theme light

Entrance motion is settled before every capture. An element hidden by its own
animation timing reads as a missing element in a screenshot, and a screenshot
that lies about what shipped costs more than the capture saved.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
REVIEW = Path(__file__).resolve().parents[1] / ".impeccable" / "review"

WIDTHS = {"desktop": 1440, "mobile": 390}

VOTER = ("asharao0142", "account-passphrase-2026")
ADMIN = ("review", "review-only-passphrase-2026")


def sign_in(page, role: str, who: tuple[str, str]) -> bool:
    """Sign in through the real form, the way a person does.

    The session cookie is cleared first: `goto(BASE)` resolves to the section
    the *current* role lands on, so a leftover voter session means the login
    form is never rendered and the selector waits forever.

    Fields are found by their label rather than by name or id, because the
    Field component owns those and they are not part of any contract.
    """
    name, passphrase = who
    page.context.clear_cookies()
    page.goto(BASE, wait_until="domcontentloaded")
    settle(page)

    if role == "admin":
        tab = page.get_by_role("button", name="Admin", exact=True)
        if tab.count():
            tab.first.click()
            page.wait_for_timeout(300)

    text_fields = page.locator("input[type='text']:visible, input:not([type]):visible")
    pw_fields = page.locator("input[type='password']:visible")
    if text_fields.count() == 0 or pw_fields.count() == 0:
        print(f"  !! {role}: no sign-in form on screen")
        return False
    text_fields.first.fill(name)
    pw_fields.first.fill(passphrase)
    page.locator('button[type="submit"]:visible').first.click()
    page.wait_for_timeout(3000)
    settle(page)
    # A failed sign-in leaves the form up with an error; say so rather than
    # screenshotting the login page under a name that claims otherwise.
    if pw_fields.count():
        err = page.locator(".zv-alert--error, [role='alert']").all_inner_texts()
        print(f"  !! {role} sign-in did not take: {err[:1]}")
        return False
    return True


def settle(page) -> None:
    """Let fonts, motion and data land before the shutter."""
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(450)
    page.evaluate(
        """() => {
            for (const el of document.getAnimations()) el.finish();
        }"""
    )
    page.wait_for_timeout(120)


def set_theme(page, theme: str) -> None:
    page.evaluate(
        "(t) => { document.documentElement.dataset.theme = t;"
        " localStorage.setItem('zv-theme', t); }",
        theme,
    )
    page.wait_for_timeout(80)


def shoot(page, name: str, label: str, width_key: str, theme: str) -> Path:
    out = REVIEW / f"{name}-{width_key}-{theme}.png"
    page.screenshot(path=str(out), full_page=True)
    print(f"  {out.name:<44} {label}")
    return out


def capture(only: str | None, themes: list[str]) -> int:
    REVIEW.mkdir(parents=True, exist_ok=True)
    made: list[Path] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width_key, width in WIDTHS.items():
            ctx = browser.new_context(
                viewport={"width": width, "height": 900},
                device_scale_factor=2 if width_key == "mobile" else 1,
            )
            page = ctx.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on(
                "console",
                lambda m: errors.append(m.text) if m.type == "error" else None,
            )

            for theme in themes:
                page.goto(BASE, wait_until="domcontentloaded")
                settle(page)
                set_theme(page, theme)

                if only in (None, "login"):
                    made.append(shoot(page, "login", "signed out", width_key, theme))

                if only in (None, "voter"):
                    if sign_in(page, "voter", VOTER):
                        set_theme(page, theme)
                        settle(page)
                        made.append(
                            shoot(page, "voter", "your ballots", width_key, theme)
                        )
                        # The published result, which is where the clause lives.
                        results = page.get_by_role(
                            "button", name="View results", exact=False
                        )
                        if results.count():
                            results.first.click()
                            page.wait_for_timeout(1200)
                            set_theme(page, theme)
                            settle(page)
                            made.append(
                                shoot(
                                    page,
                                    "results",
                                    "published results and the clause",
                                    width_key,
                                    theme,
                                )
                            )

                if only in (None, "admin"):
                    if sign_in(page, "admin", ADMIN):
                        set_theme(page, theme)
                        settle(page)
                        made.append(
                            shoot(page, "admin", "elections", width_key, theme)
                        )

            if errors:
                print(f"  !! console/page errors at {width_key}:")
                for e in errors[:6]:
                    print(f"     {e}")
            ctx.close()
        browser.close()

    print(f"\n{len(made)} capture(s) in {REVIEW}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["login", "voter"])
    ap.add_argument(
        "--theme", action="append", choices=["dark", "light"], dest="themes"
    )
    args = ap.parse_args()
    return capture(args.only, args.themes or ["dark", "light"])


if __name__ == "__main__":
    sys.exit(main())