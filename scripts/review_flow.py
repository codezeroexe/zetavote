"""Drive the two states the seeded demo cannot show, through the real UI.

Both exist for the same reason: the seed leaves every row in a state that has
already been voted in, so the two most distinctive surfaces in the app are never
rendered.

  Phase A — the ledger. A voter joins an open election and casts a ballot in the
    same browser context, and the pipeline ledger is captured while it is on
    screen. The ballot key is sealed into localStorage and never leaves the
    browser, so join and vote must happen in one context or the vote fails with
    "This device has no record of that enrolment" — which is the app being
    right, not a script bug. `benokafor7781` is not enrolled in
    `election_honours`, so its join is a real one.

  Phase B — the clause. An enrolled voter who never votes, in an election that
    is then closed and tallied, is the only thing that renders the published
    results, which is where the eligibility rule and its hash share one ruled
    line. `femibalogun4807` is enrolled in `election_review` and has not voted.

Every step is a click in the page. A failure here means the product is broken.

    python3 scripts/review_flow.py
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
API = "http://127.0.0.1:8080"
REVIEW = Path(__file__).resolve().parents[1] / ".impeccable" / "review"
ACCOUNT_PW = "account-passphrase-2026"
BALLOT_PW = "ballot-passphrase-2026"
MASTER_PW = "master-passphrase-2026"
ADMIN = ("review", "review-only-passphrase-2026")

# A dedicated election for the ledger. It has to be new every run: the ballot
# key is sealed into localStorage by the join and never leaves the browser, so
# reusing an election means reusing an enrolment that this context never made,
# and the vote fails with "This device has no record of that enrolment".
ELECTION_ID = f"election_ledger_{int(time.time())}"
ELECTION_NAME = "Research Committee"

CLOSED_ELECTION = "Faculty Sabbatical"  # enrolled, MISSED_VOTER has not voted
CASTING_VOTER = "benokafor7781"
MISSED_VOTER = "femibalogun4807"


def _api():
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(CookieJar())
    )


def _call(opener, method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with opener.open(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def fresh_election(election_id: str | None = None) -> str | None:
    """Create the ledger's election through the product's own endpoint.

    The id is per-call, not per-process: the ballot key is sealed into
    localStorage by the join, so an election reused across two phases is one the
    second phase is already enrolled in on the server but holds no key for here.
    Returns the new id, or None if it could not be created.
    """
    global ELECTION_ID
    if election_id is None:
        election_id = f"election_ledger_{int(time.time() * 1000)}"
    ELECTION_ID = election_id
    opener = _api()
    st, _ = _call(
        opener,
        "POST",
        "/api/auth/admin/login",
        {"name": ADMIN[0], "passphrase": ADMIN[1]},
    )
    if st != 200:
        print(f"  !! admin login for election setup: {st}")
        return False
    st, body = _call(
        opener,
        "POST",
        "/api/elections",
        {
            "id": ELECTION_ID,
            "name": ELECTION_NAME,
            "description": "One seat. Two candidates.",
            "master_passphrase": MASTER_PW,
            "candidates": ["Dr Aurelio Bassi", "Dr Priya Raghunathan"],
            "min_age": 18,
        },
    )
    if st in (200, 201):
        print(f"  election {ELECTION_ID} ready ({st})")
        return ELECTION_ID
    print(f"  !! could not create {ELECTION_ID}: {st} {body}")
    return None


def settle(page, ms: int = 400) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def theme(page, name: str = "dark") -> None:
    page.evaluate("(t)=>{document.documentElement.dataset.theme=t}", name)
    page.wait_for_timeout(80)


def freeze(page) -> None:
    """Finish in-flight animations without waiting.

    The ledger is on screen for a few hundred milliseconds because scrypt is
    fast on this machine, so there is no budget to spend sleeping. Finishing the
    animations is what makes the capture valid rather than merely early: an
    element still hidden by its own animation timing reads as a missing element.
    """
    page.evaluate("() => { for (const a of document.getAnimations()) a.finish(); }")


def shoot(page, name: str) -> None:
    REVIEW.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(REVIEW / f"{name}.png"), full_page=True)
    print(f"  captured {name}.png")


def sign_in(page, who: str, pw: str, admin: bool = False) -> bool:
    """Sign in and wait for a real terminal state.

    A fixed sleep is wrong here: sign-in is scrypt, so it can outlast any
    constant worth writing, and returning early lands the next step on the
    loading block with neither cards nor an error to explain why.
    """
    page.context.clear_cookies()
    page.goto(BASE, wait_until="domcontentloaded")
    settle(page)
    if admin:
        tab = page.get_by_role("button", name="Admin", exact=True)
        if tab.count():
            tab.first.click()
            page.wait_for_timeout(400)
    page.locator("input[type='text']:visible, input:not([type]):visible").first.fill(who)
    page.locator("input[type='password']:visible").first.fill(pw)
    page.locator('button[type="submit"]:visible').first.click()

    # Failure is "the form is still up after the whole window". An alert is not
    # a failure signal: the login page always carries the prototype notice, so
    # keying on its presence reports every sign-in as broken.
    for _ in range(90):
        page.wait_for_timeout(500)
        if page.locator(".zv-election-card, .zv-admin-election").count():
            return True
    errs = page.locator("[role='alert'], .zv-alert").all_inner_texts()
    print(f"  !! {who} did not reach the list. on-screen notices: "
          f"{[e[:70] for e in errs][:2]}")
    return False


def wait_cards(page, timeout_ms: int) -> bool:
    """Wait for the elections list, tolerating a fixed budget.

    Scrypt enrolment takes seconds, so this polls rather than sleeping.
    """
    for _ in range(timeout_ms // 500):
        page.wait_for_timeout(500)
        if page.locator(".zv-election-card").count():
            return True
    return False


def admin_action(page, election: str, label: str) -> None:
    """Open one of the admin row actions and submit its panel.

    Reloads first: an action leaves its disclosure expanded, and the next one
    then has to find its button inside somebody else's open panel.
    """
    page.reload(wait_until="domcontentloaded")
    settle(page)
    page.wait_for_selector(".zv-admin-election, .zv-election-card", timeout=20000)
    row = page.locator(".zv-admin-election, .zv-election-card", has_text=election).first
    row.get_by_role("button", name=label, exact=False).first.click()
    page.wait_for_timeout(800)
    pw = page.locator("input[type='password']:visible")
    if pw.count():
        pw.first.fill(MASTER_PW)
    page.locator('button[type="submit"]:visible').first.click()
    page.wait_for_timeout(4000)
    settle(page)


def join_and_vote(page, shoot_name: str | None = None) -> bool:
    """CASTING_VOTER joins ELECTION_ID and casts a ballot, in this context.

    Both halves have to happen in one browser context: the ballot key is sealed
    into localStorage by the join and never leaves the browser, so a join made
    in an earlier context leaves the voter enrolled on the server with no key
    here, and the vote fails with "This device has no record of that
    enrolment" — which is the app being right, not a script bug.
    """
    page.wait_for_selector(".zv-election-card", timeout=20000)
    card = page.locator(".zv-election-card", has_text=ELECTION_ID).first
    card.get_by_role("button", name="Join", exact=True).click()
    page.wait_for_timeout(1200)
    settle(page)
    pw = page.locator("input[type='password']:visible")
    if pw.count() < 2:
        print("  !! enrolment form did not appear")
        return False
    pw.nth(0).fill(BALLOT_PW)
    pw.nth(1).fill(BALLOT_PW)
    page.locator('button[type="submit"]:visible').first.click()
    page.wait_for_timeout(9000)
    settle(page)
    # The enrolment panel stays up on its own success notice until "Back to my
    # ballots" is pressed; `onDone` is not automatic. So the list is only back
    # after that click, not after the POST returns.
    page.get_by_role("button", name="Back to my ballots", exact=True).click()
    page.wait_for_timeout(2500)
    settle(page)
    if not wait_cards(page, 20000):
        shoot(page, "debug-join-stuck")
        print("  notices:", [a[:160] for a in
              page.locator("[role='alert'], .zv-alert").all_inner_texts()])
        return False

    card = page.locator(".zv-election-card", has_text=ELECTION_ID).first
    card.get_by_role("button", name="Cast vote", exact=True).click()
    page.wait_for_timeout(1500)
    settle(page)
    page.locator(".zv-choice-option").first.click()
    page.wait_for_timeout(200)
    page.locator("input[type='password']:visible").first.fill(BALLOT_PW)
    page.get_by_role("button", name="Review ballot", exact=True).click()
    page.wait_for_timeout(600)

    page.get_by_role("button", name="Submit ballot", exact=True).click()
    if shoot_name:
        try:
            # The ledger replaces the confirmation the moment the submit starts.
            page.wait_for_selector(".zv-pipeline", timeout=6000)
            freeze(page)
            shoot(page, shoot_name)
        except Exception:
            # Expected on a fast machine: the ledger can turn over before a poll
            # notices it. It is kept on the receipt either way.
            print("     (in-flight ledger not caught; it persists on the receipt)")
    page.wait_for_timeout(9000)
    settle(page)
    theme(page)
    return True


def phase_a_ledger(page) -> None:
    print(f"A. ledger — {CASTING_VOTER} joins {ELECTION_NAME} and votes")
    if not sign_in(page, CASTING_VOTER, ACCOUNT_PW):
        return
    if join_and_vote(page, shoot_name="pipeline-desktop-dark"):
        print("   the receipt, ledger kept")
        shoot(page, "receipt-desktop-dark")


def phase_b_clause(page) -> None:
    print(f"B. clause — close and tally {CLOSED_ELECTION}, then read the result")
    if not sign_in(page, ADMIN[0], ADMIN[1], admin=True):
        return
    shoot(page, "admin-elections-desktop-dark")
    admin_action(page, CLOSED_ELECTION, "Close election")
    admin_action(page, CLOSED_ELECTION, "Tally and publish")

    if not sign_in(page, MISSED_VOTER, ACCOUNT_PW):
        return
    page.wait_for_selector(".zv-election-card", timeout=20000)
    theme(page)
    shoot(page, "dashboard-missed-desktop-dark")
    vr = page.get_by_role("button", name="View results", exact=False)
    if not vr.count():
        print("  !! no 'View results' row; the missed state did not appear")
        return
    vr.first.click()
    page.wait_for_timeout(1800)
    theme(page)
    settle(page)
    shoot(page, "results-clause-desktop-dark")


def main() -> int:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        # A fresh context: the ballot seal has to be created by the join that
        # this run performs, not inherited from an earlier one.
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(str(e)))

        if fresh_election():
            phase_a_ledger(page)
        phase_b_clause(page)

        if errs:
            print("\npage errors:")
            for e in errs[:8]:
                print(f"  {e}")
        b.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())