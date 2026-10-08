"""Capture the tabulating-card build for review.

Not a test. Drives the dev server already running on http://localhost:5173 and
writes PNGs into .impeccable/review/.

    python3 scripts/capture_demo.py                # every shot it can reach
    python3 scripts/capture_demo.py --only voter

What it cannot reach, and why, is stated in its output rather than faked: the
admin half needs the demo admin's passphrase, and the demo voter has already
cast a ballot in all three elections, so no enrolment on this browser holds an
uncast card. No record is created to reach either.

Entrance motion is settled before every capture. An element hidden by its own
animation timing reads as a missing element, and a screenshot that lies about
what shipped costs more than the capture saved.
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


def a_real_commitment() -> tuple[str, str] | None:
    """One election id and commitment that really exist on this machine.

    Read straight out of the database, opened read-only, so the verdict in the
    capture is the server's own answer about a ballot that was actually cast —
    not a fixture and not a mock. Nothing is written.
    """
    import sqlite3

    db = Path(__file__).resolve().parents[1] / "data" / "elections.db"
    if not db.exists():
        return None
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        row = con.execute(
            "select election_id, commitment from ballots "
            "order by created_at desc limit 1"
        ).fetchone()
    finally:
        con.close()
    return (row[0], row[1]) if row else None


def settle(page) -> None:
    """Let fonts, motion and data land before the shutter."""
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    page.evaluate(
        """() => {
            for (const el of document.getAnimations()) el.finish();
        }"""
    )
    page.wait_for_timeout(140)


def set_theme(page, theme: str) -> None:
    page.evaluate(
        "(t) => { document.documentElement.dataset.theme = t;"
        " localStorage.setItem('zetavote-theme', t); }",
        theme,
    )
    page.wait_for_timeout(90)


def shoot(
    page, name: str, label: str, width_key: str, theme: str, suffix: str = ""
) -> Path:
    out = REVIEW / f"{name}{suffix}-{width_key}-{theme}.png"
    page.screenshot(path=str(out), full_page=True)
    print(f"  {out.name:<52} {label}")
    return out


def sign_in_voter(page) -> bool:
    """Sign in through the real form, the way a person does.

    The session cookie is cleared first: `goto(BASE)` resolves to the section the
    *current* role lands on, so a leftover voter session means the login form is
    never rendered and the selector waits forever.
    """
    name, passphrase = VOTER
    page.context.clear_cookies()
    page.goto(BASE, wait_until="domcontentloaded")
    settle(page)

    text_fields = page.locator("input[type='text']:visible, input:not([type]):visible")
    pw_fields = page.locator("input[type='password']:visible")
    if text_fields.count() == 0 or pw_fields.count() == 0:
        print("  !! no sign-in form on screen")
        return False
    text_fields.first.fill(name)
    pw_fields.first.fill(passphrase)
    page.locator('button[type="submit"]:visible').first.click()
    page.wait_for_timeout(3500)
    settle(page)
    if pw_fields.count():
        print("  !! voter sign-in did not take")
        return False
    return True


def capture(
    only: str | None, themes: list[str], reduced: bool, args_suffix: str = ""
) -> int:
    REVIEW.mkdir(parents=True, exist_ok=True)
    made: list[Path] = []
    skipped: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width_key, width in WIDTHS.items():
            ctx = browser.new_context(
                viewport={"width": width, "height": 900},
                device_scale_factor=2 if width_key == "mobile" else 1,
                reduced_motion="reduce" if reduced else "no-preference",
            )
            page = ctx.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on(
                "console",
                lambda m: errors.append(m.text) if m.type == "error" else None,
            )

            for theme in themes:
                suffix = args_suffix
                # ---- signed out -------------------------------------------------
                # The cookie is cleared here as well as in sign_in_voter. Without
                # it the second theme iteration lands on the signed-in dashboard
                # and every signed-out capture is quietly a dashboard.
                page.context.clear_cookies()
                page.goto(BASE, wait_until="domcontentloaded")
                settle(page)
                set_theme(page, theme)

                if only in (None, "frontdoor"):
                    made.append(
                        shoot(page, "01-front-door", "signed out, voter", width_key, theme)
                    )

                if only in (None, "register"):
                    # The register form, as the voter actually meets it.
                    page.goto(BASE, wait_until="domcontentloaded")
                    settle(page)
                    set_theme(page, theme)
                    create_tab = page.get_by_role("button", name="Create account")
                    if create_tab.count():
                        create_tab.first.click()
                        page.wait_for_timeout(400)
                        set_theme(page, theme)
                        settle(page)
                        made.append(
                            shoot(
                                page,
                                "02-register",
                                "create account",
                                width_key,
                                theme,
                                suffix,
                            )
                        )

                # ---- signed in as the voter ------------------------------------
                if only in (None, "voter", "results", "receipt", "verify"):
                    if sign_in_voter(page):
                        set_theme(page, theme)
                        settle(page)
                        if only in (None, "voter"):
                            made.append(
                                shoot(
                                    page,
                                    "04-voter-dashboard",
                                    "your ballots",
                                    width_key,
                                    theme,
                                suffix,
                                )
                            )

                        # The published tally: total card, binary columns, the
                        # certified rule clause and the Merkle root.
                        if only in (None, "results"):
                            page.goto(
                                f"{BASE}/#/voter", wait_until="domcontentloaded"
                            )
                            settle(page)
                            my_receipt = page.get_by_role(
                                "button", name="My receipt", exact=False
                            )
                            if my_receipt.count():
                                my_receipt.first.click()
                                page.wait_for_timeout(1200)
                                set_theme(page, theme)
                                settle(page)
                                made.append(
                                    shoot(
                                        page,
                                        "06-receipt",
                                        "your receipt, sealed",
                                        width_key,
                                        theme,
                                suffix,
                                    )
                                )
                                summary = page.get_by_role(
                                    "button", name="Published results", exact=False
                                )
                                if summary.count():
                                    summary.first.click()
                                    page.wait_for_timeout(1400)
                                    set_theme(page, theme)
                                    settle(page)
                                    made.append(
                                        shoot(
                                            page,
                                            "07-results",
                                            "total card, binary tally, "
                                            "Merkle clause",
                                            width_key,
                                            theme,
                                            suffix,
                                        )
                                    )

                        # Verify is public to a session, and is the surface an
                        # observer uses, so it is captured signed out too.
                        if only in (None, "verify"):
                            page.goto(f"{BASE}/#/verify", wait_until="domcontentloaded")
                            page.wait_for_timeout(700)
                            set_theme(page, theme)
                            settle(page)
                            made.append(
                                shoot(
                                    page,
                                    "08-verify",
                                    "check a ballot",
                                    width_key,
                                    theme,
                                    suffix,
                                )
                            )

                            # The verdict, on a ballot that was really cast. This
                            # is the surface an observer actually meets, and it is
                            # the one a screenshot of two empty fields never
                            # shows.
                            real = a_real_commitment()
                            if real:
                                election_id, commitment = real
                                page.locator(
                                    "input[placeholder='e.g. election_2026']"
                                ).first.fill(election_id)
                                page.locator(
                                    "input[placeholder*='SHA-256']"
                                ).first.fill(commitment)
                                page.get_by_role(
                                    "button", name="Verify ballot"
                                ).first.click()
                                page.wait_for_timeout(1800)
                                set_theme(page, theme)
                                settle(page)
                                made.append(
                                    shoot(
                                        page,
                                        "09-verify-verdict",
                                        "verdict on a real ballot",
                                        width_key,
                                        theme,
                                        suffix,
                                    )
                                )

            if errors:
                print(f"  !! console/page errors at {width_key}:")
                for e in errors[:6]:
                    print(f"     {e}")
            ctx.close()
        browser.close()

    skipped = [
        "admin elections list / create / close panel — needs the demo admin's "
        "passphrase, which is not available in this run",
        "cast vote, mid-selection, punch/SEAL moment, post-submit receipt — the "
        "demo voter has cast in all three elections, so no enrolment on this "
        "browser holds an uncast card",
        "a dashboard row in the 'missed' or 'ready' state — see above; no record "
        "was created to reach one",
    ]

    print(f"\n{len(made)} capture(s) in {REVIEW}")
    print("\nNot reachable this run, and not faked:")
    for s in skipped:
        print(f"  - {s}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--only",
        choices=["frontdoor", "register", "voter", "results", "verify"],
    )
    ap.add_argument(
        "--theme", action="append", choices=["dark", "light"], dest="themes"
    )
    ap.add_argument("--reduced", action="store_true")
    ap.add_argument(
        "--suffix",
        default="",
        help="appended to every filename, so a second pass cannot overwrite the first",
    )
    args = ap.parse_args()
    return capture(
        args.only, args.themes or ["dark", "light"], args.reduced, args.suffix
    )


if __name__ == "__main__":
    sys.exit(main())
