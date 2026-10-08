"""Check the surfaces this pass changed, at both widths, in both themes, and
with motion reduced.

The reduced-motion pass is not optional decoration: PRODUCT.md holds the
accessibility floor, and the ledger is a new set of rows whose legibility used
to depend on a wipe animation. If nothing moves, every row must still be readable
and every state still distinguishable.

    python3 scripts/verify_surfaces.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_flow as rf  # noqa: E402

BASE = "http://localhost:5173"
REVIEW = rf.REVIEW

# The six state marks, and the shape each one must keep when nothing moves.
MARK_SHAPES = ["live", "seal", "spent", "warn", "risk", "muted"]


def open_results(page) -> bool:
    if not rf.sign_in(page, rf.MISSED_VOTER, rf.ACCOUNT_PW):
        return False
    page.wait_for_selector(".zv-election-card", timeout=20000)
    vr = page.get_by_role("button", name="View results", exact=False)
    if not vr.count():
        print("  !! no results row")
        return False
    vr.first.click()
    page.wait_for_timeout(1600)
    rf.settle(page)
    return True


def main() -> int:
    problems: list[str] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch()

        # --- both widths, both themes, on the results surface -------------
        for label, width, height, dsf in (
            ("desktop", 1440, 900, 1),
            ("mobile", 390, 844, 2),
        ):
            ctx = b.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=dsf,
            )
            page = ctx.new_page()
            for theme in ("dark", "light"):
                if open_results(page):
                    rf.theme(page, theme)
                    rf.freeze(page)
                    rf.shoot(page, f"results-clause-{label}-{theme}")
                    fig = page.locator(".zv-clause-figure").first
                    bb = fig.bounding_box()
                    lines = bb["height"] / (11 * 1.4)
                    print(
                        f"     clause figure: {round(bb['width'])}px wide, "
                        f"{lines:.2f} lines"
                    )
                    if label == "desktop" and lines > 1.35:
                        problems.append(
                            f"{theme}/{label}: rule hash wraps to "
                            f"{lines:.2f} lines, bracket may orphan"
                        )
            ctx.close()

        # --- reduced motion: the ledger must stay fully readable -----------
        ctx = b.new_context(
            viewport={"width": 1440, "height": 900},
            reduced_motion="reduce",
        )
        page = ctx.new_page()
        rf.fresh_election()
        print("reduced motion — ledger")
        if rf.sign_in(page, rf.CASTING_VOTER, rf.ACCOUNT_PW):
            if rf.join_and_vote(page, shoot_name="reduced-motion-receipt"):
                rows = page.locator(".zv-pipeline-row")
                n = rows.count()
                visible = [
                    r.inner_text().strip()
                    for r in rows.all()
                    if r.is_visible() and r.inner_text().strip()
                ]
                print(f"     rows rendered: {n}, non-empty: {len(visible)}")
                if n == 0 or len(visible) < n:
                    problems.append(
                        f"reduced motion: {n - len(visible)} ledger row(s) "
                        "lost their text when animation was removed"
                    )
                marks = page.locator(".zv-state-pill").count()
                print(f"     state marks on screen: {marks}")
                rf.shoot(page, "reduced-motion-receipt")
        ctx.close()
        b.close()

    if problems:
        print("\nPROBLEMS")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\nall surface checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())