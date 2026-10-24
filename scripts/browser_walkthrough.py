"""Walk the browser's exact sequence against a live server over a real socket.

Not a test — run it by hand. TestClient short-circuits the transport, and this
exists to exercise the one path the suite never does: real HTTP, real cookies,
real scrypt cost, and the served frontend bundle.

    python3 scripts/browser_walkthrough.py
"""

import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import backend.audit as audit  # noqa: E402
import backend.database as database  # noqa: E402

# Hermetic by construction. config.py resolves its paths at import time, so point
# the modules at a temp directory after importing them but before backend.app
# runs init_db() — otherwise this script would read and overwrite the real
# elections.db, and a second run would fail on leftovers from the first.
SANDBOX = Path(tempfile.mkdtemp(prefix="zetavote-walkthrough-"))
for _module in (database, audit):
    _module.DATA_DIR = SANDBOX
    _module.DB_PATH = SANDBOX / "elections.db"
    _module.AUDIT_LOG_PATH = SANDBOX / "votes_audit.log"
    _module.KEYS_DIR = SANDBOX / "keys"

from backend import crypto  # noqa: E402
from backend.app import app  # noqa: E402

BASE = "http://127.0.0.1:8099"
MASTER = "master-passphrase"
ACCOUNT_PASSPHRASE = "account-passphrase"
BALLOT_PASSPHRASE = "ballot-passphrase"
NAME = "Asha Rao"
DOB = "1996-03-12"
# Old enough for nothing: used to check an under-age refusal.
MINOR_DOB = "2016-04-02"

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
failures: list[str] = []


def call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{BASE}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with opener.open(request) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if condition else 'FAIL'} {label}{'' if condition else f'  <- {detail}'}")
    if not condition:
        failures.append(label)


def step(title: str) -> None:
    print(f"\n{title}")


def build_ballot(election, private_key: str, public_key: str, account: str, choice: str):
    """The same bytes frontend/src/services/crypto.ts:buildVote produces."""
    election_id = election["id"]
    vote_nonce = crypto.b64(os.urandom(16))
    reveal_salt = crypto.b64(os.urandom(32))
    timestamp = now()
    plaintext = crypto.canonical_json({
        "election_id": election_id, "voter_id": account, "voter_pubkey": public_key,
        "choice": choice, "vote_nonce": vote_nonce, "timestamp": timestamp,
    })
    sealed = crypto.seal_with_public_key(plaintext.encode(), election["public_key"])
    row = {
        "election_id": election_id, "voter_id": account, "voter_pubkey": public_key,
        "ballot_id": crypto.ballot_id(election_id, public_key, vote_nonce),
        "commitment": crypto.ballot_commitment(election_id, public_key, reveal_salt, choice),
        "vote_nonce": vote_nonce, "timestamp": timestamp,
        "ephemeral_pub": sealed["ephemeral_pub"], "nonce": sealed["nonce"],
        "ciphertext": sealed["ciphertext"],
    }
    return {**row, "signature": crypto.sign_message(private_key, crypto.canonical_json(row).encode())}, reveal_salt


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seal(private_key_b64: str, passphrase: str) -> dict:
    key, salt = crypto.derive_key_from_passphrase(passphrase, n=crypto.SCRYPT_N_VOTER)
    blob = crypto.encrypt_bytes(crypto.unb64(private_key_b64), key)
    blob["salt"] = crypto.b64(salt)
    return blob


import threading  # noqa: E402
import uvicorn  # noqa: E402

config = uvicorn.Config(app, host="127.0.0.1", port=8099, log_level="error")
server = uvicorn.Server(config)
threading.Thread(target=server.run, daemon=True).start()
while not server.started:
    pass

try:
    step("1. bootstrap the first admin (run.py --bootstrap-code equivalent)")
    from backend import auth  # noqa: E402

    code = auth.mint_bootstrap_code()
    status, _ = call("POST", "/api/auth/bootstrap", {"name": "admin", "passphrase": MASTER, "code": code})
    check("admin created", status == 200, str(status))
    status, _ = call("POST", "/api/auth/admin/login", {"name": "admin", "passphrase": MASTER})
    check("admin signed in (session cookie held)", status == 200, str(status))

    step("2. admin creates an election with an eligible list")
    status, election = call("POST", "/api/elections", {
        "id": "e1", "name": "Election One", "master_passphrase": MASTER,
        "candidates": ["Alice", "Bob"],
        "min_age": 18,
    })
    check("election created", status == 200, json.dumps(election)[:120])
    check("candidates frozen", election.get("candidates") == ["Alice", "Bob"])

    step("3. register an account from the login page")
    status, available = call("GET", f"/api/accounts/available?name={NAME.replace(' ', '%20')}&digits=0142")
    check("username available", available.get("available") is True, json.dumps(available))
    check("username is slug + digits", available.get("username") == "asharao0142", json.dumps(available))

    account_private, account_public = crypto.generate_ed25519_keypair()
    account_sealed = seal(account_private, ACCOUNT_PASSPHRASE)
    status, created = call("POST", "/api/accounts", {
        "username": "asharao0142", "name": NAME, "dob": DOB,
        "public_key": account_public, "sealed_key": account_sealed,
    })
    check("account created (201)", status == 201, json.dumps(created)[:160])
    check("no duplicate warning", created.get("warning") is None, json.dumps(created))

    step("4. a taken username suggests rather than refuses")
    status, taken = call("POST", "/api/accounts", {
        "username": "asharao0142", "name": "Other Person", "dob": "1990-01-01",
        "public_key": account_public, "sealed_key": account_sealed,
    })
    check("409 on a taken username", status == 409, str(status))
    check("alternatives offered", bool(taken.get("suggestions")), json.dumps(taken))

    step("5. sign in: username + sealed key opened locally, only a signature sent")
    status, sealed = call("GET", "/api/accounts/asharao0142/sealed-key")
    check("sealed key fetched", status == 200, str(status))
    key, _ = crypto.derive_key_from_passphrase(
        ACCOUNT_PASSPHRASE, crypto.unb64(sealed["sealed_key"]["salt"]), n=crypto.SCRYPT_N_VOTER
    )
    recovered = crypto.decrypt_bytes(sealed["sealed_key"], key)
    check("passphrase opens the key locally", crypto.b64(recovered) == account_private)
    status, challenge = call("POST", "/api/auth/challenge", {"role": "voter", "username": "asharao0142"})
    signature = crypto.sign_message(account_private, challenge["challenge"].encode())
    status, session = call("POST", "/api/auth/voter/login", {
        "username": "asharao0142", "challenge": challenge["challenge"], "signature": signature,
    })
    check("signed in as the account", status == 200 and session.get("username") == "asharao0142", json.dumps(session))
    status, replay = call("POST", "/api/auth/voter/login", {
        "username": "asharao0142", "challenge": challenge["challenge"], "signature": signature,
    })
    check("the same challenge cannot be replayed", status == 401, str(status))

    step("6. enrol: a fresh ballot key, claimed with the account key")
    ballot_private, ballot_public = crypto.generate_ed25519_keypair()
    ballot_sealed = seal(ballot_private, BALLOT_PASSPHRASE)
    status, enrol_challenge = call("POST", "/api/auth/challenge", {"role": "voter", "username": "asharao0142"})
    status, enrolment = call("POST", "/api/elections/e1/enrol", {
        "ballot_public_key": ballot_public, "sealed_ballot_key": ballot_sealed,
        "challenge": enrol_challenge["challenge"],
        "signature": crypto.sign_message(account_private, enrol_challenge["challenge"].encode()),
    })
    check("enrolled (201)", status == 201, json.dumps(enrolment)[:160])
    check("the enrolment is scoped to this account",
          enrolment.get("username") == "asharao0142" and enrolment.get("election_id") == "e1",
          json.dumps(enrolment))
    check("ballot key is not the account key", ballot_public != account_public)

    step("7. a second account for the same person now gets a ballot too")
    # Same person, spelled the way their keyboard had it that day, so the slug
    # matches and the roster line is the same one.
    twin_private, twin_public = crypto.generate_ed25519_keypair()
    twin_sealed = seal(twin_private, "twin-passphrase")
    status, twin = call("POST", "/api/accounts", {
        "username": "asharao0143", "name": "asha rao", "dob": DOB,
        "public_key": twin_public, "sealed_key": twin_sealed,
    })
    check("second account allowed (201), not blocked", status == 201, f"{status} {twin}")
    check("duplicate name and date of birth only warns", bool(twin.get("warning")), json.dumps(twin))

    call("POST", "/api/auth/logout")
    ch = call("POST", "/api/auth/challenge", {"role": "voter", "username": "asharao0143"})[1]
    call("POST", "/api/auth/voter/login", {
        "username": "asharao0143", "challenge": ch["challenge"],
        "signature": crypto.sign_message(twin_private, ch["challenge"].encode()),
    })
    ch = call("POST", "/api/auth/challenge", {"role": "voter", "username": "asharao0143"})[1]
    status, twin_enrolment = call("POST", "/api/elections/e1/enrol", {
        "ballot_public_key": twin_public, "sealed_ballot_key": twin_sealed,
        "challenge": ch["challenge"],
        "signature": crypto.sign_message(twin_private, ch["challenge"].encode()),
    })
    # Stated, not hidden: with the roster gone there is no line to claim, so a
    # duplicate account really does get its own ballot. Step 14 shows the one
    # lever an admin has.
    check("and it is NOT refused — this is the cost of dropping the roster",
          status == 201, f"{status} {twin_enrolment}")

    # Back to the original account, since the session is now the twin's and the
    # rest of the walkthrough is that person voting.
    call("POST", "/api/auth/logout")
    ch = call("POST", "/api/auth/challenge", {"role": "voter", "username": "asharao0142"})[1]
    call("POST", "/api/auth/voter/login", {
        "username": "asharao0142", "challenge": ch["challenge"],
        "signature": crypto.sign_message(account_private, ch["challenge"].encode()),
    })

    step("8. cast a ballot with the ballot key")
    detail = call("GET", "/api/elections/e1")[1]
    payload, reveal_salt = build_ballot(detail, ballot_private, ballot_public, "asharao0142", "Alice")
    status, vote = call("POST", "/api/elections/e1/vote", payload)
    check("ballot accepted", status == 200, json.dumps(vote)[:160])
    commitment = vote.get("ballot_commitment")

    step("9. verify while the election is still open")
    status, verified = call("GET", f"/api/elections/e1/verify/{commitment}")
    check("ballot verifies", status == 200 and verified.get("valid") is True, json.dumps(verified)[:200])
    check("no identity leaked", "asharao0142" not in json.dumps(verified))

    step("10. dashboard, close, tally, published results")
    status, mine = call("GET", "/api/me/elections")
    row = mine["elections"][0]
    check("dashboard shows enrolled and voted", row["registered"] is True and row["voted"] is True, json.dumps(row))
    check("counts hidden while open", "counts" not in row, json.dumps(row))

    status, _ = call("POST", "/api/elections/e1/close", {"master_passphrase": MASTER})
    check("closed with the master passphrase", status == 200, str(status))
    status, tally = call("POST", "/api/elections/e1/tally", {"master_passphrase": MASTER})
    check("tallied", status == 200 and tally.get("total_votes") == 1, json.dumps(tally)[:160])
    check("nothing rejected", tally.get("rejected_ballots") == 0)

    status, results = call("GET", "/api/elections/e1/results")
    check("results published", status == 200, str(status))
    check("the rule is published", results.get("criteria") == {"max_age": None, "min_age": 18},
          json.dumps(results)[:200])
    check("criteria_hash published", len(results.get("criteria_hash", "")) == 64,
          json.dumps(results)[:200])

    # Recomputed the way any reader of the results would: apply the documented
    # rule and canonicalise. No server helper involved.
    rows = {"max_age": None, "min_age": 18}
    check("criteria_hash is recomputable from the published rule",
          results["criteria_hash"] == crypto.sha256_hex(crypto.canonical_json(rows)),
          results["criteria_hash"])

    step("11. the voter reveals their own choice locally, offline")
    revealed = [
        c for c in ["Alice", "Bob"]
        if crypto.ballot_commitment("e1", ballot_public, reveal_salt, c) == commitment
    ]
    check("reveal finds their own vote", revealed == ["Alice"], str(revealed))

    step("12. a second election: the same account, an unrelated ballot key")
    # Creating an election is admin-gated, so this is the admin signing back in,
    # then the account again — the two roles alternate exactly as they would in
    # a real session.
    call("POST", "/api/auth/logout")
    call("POST", "/api/auth/admin/login", {"name": "admin", "passphrase": MASTER})
    status, _ = call("POST", "/api/elections", {
        "id": "e2", "name": "Election Two", "master_passphrase": MASTER,
        "candidates": ["Carol", "Dave"],
        "min_age": 18, "max_age": 30,
    })
    check("second election created", status == 200, str(status))
    call("POST", "/api/auth/logout")
    ch = call("POST", "/api/auth/challenge", {"role": "voter", "username": "asharao0142"})[1]
    call("POST", "/api/auth/voter/login", {
        "username": "asharao0142", "challenge": ch["challenge"],
        "signature": crypto.sign_message(account_private, ch["challenge"].encode()),
    })
    second_private, second_public = crypto.generate_ed25519_keypair()
    second_sealed = seal(second_private, "second-ballot-passphrase")
    ch = call("POST", "/api/auth/challenge", {"role": "voter", "username": "asharao0142"})[1]
    status, second = call("POST", "/api/elections/e2/enrol", {
        "ballot_public_key": second_public, "sealed_ballot_key": second_sealed,
        "challenge": ch["challenge"],
        "signature": crypto.sign_message(account_private, ch["challenge"].encode()),
    })
    check("one account, two enrolments", status == 201, f"{status} {second}")
    check("each election gets its own ballot key", second_public != ballot_public)
    check("no ballot key is the account key",
          ballot_public != account_public and second_public != account_public)

    detail2 = call("GET", "/api/elections/e2")[1]
    payload2, _salt2 = build_ballot(detail2, second_private, second_public, "asharao0142", "Dave")
    status, vote2 = call("POST", "/api/elections/e2/vote", payload2)
    check("ballot accepted in the second election", status == 200, json.dumps(vote2)[:160])
    check("the two commitments differ, so the ballots cannot be linked",
          vote2.get("ballot_commitment") != commitment)

    call("POST", "/api/elections/e2/close", {"master_passphrase": MASTER})
    status, tally2 = call("POST", "/api/elections/e2/tally", {"master_passphrase": MASTER})
    check("second election tallies independently",
          status == 200 and tally2.get("choice_breakdown") == {"Dave": 1}, json.dumps(tally2)[:160])
    status, results2 = call("GET", "/api/elections/e2/results")
    check("its own rule hash is published",
          results2.get("criteria_hash") != results.get("criteria_hash"), json.dumps(results2)[:200])
    check("the second election's band is published",
          results2.get("criteria") == {"max_age": 30, "min_age": 18}, json.dumps(results2)[:200])

    step("13. an account below the age rule is told the rule, not its age")
    # Its own still-open election: e1 and e2 are both closed by now, and a closed
    # window refuses an under-age account for an entirely different reason.
    call("POST", "/api/auth/logout")
    call("POST", "/api/auth/admin/login", {"name": "admin", "passphrase": MASTER})
    status, _ = call("POST", "/api/elections", {
        "id": "e3", "name": "Election Three", "master_passphrase": MASTER,
        "candidates": ["Alice", "Bob"], "min_age": 18,
    })
    check("a third election is open for the eligibility check", status == 200, str(status))
    call("POST", "/api/auth/logout")
    minor_private, minor_public = crypto.generate_ed25519_keypair()
    minor_sealed = seal(minor_private, "minor-passphrase")
    status, created_minor = call("POST", "/api/accounts", {
        "username": "kid0142", "name": "Kid Person", "dob": MINOR_DOB,
        "public_key": minor_public, "sealed_key": minor_sealed,
    })
    check("an under-age account can still register (201)", status == 201,
          f"{status} {created_minor}")
    call("POST", "/api/auth/logout")
    ch = call("POST", "/api/auth/challenge", {"role": "voter", "username": "kid0142"})[1]
    call("POST", "/api/auth/voter/login", {
        "username": "kid0142", "challenge": ch["challenge"],
        "signature": crypto.sign_message(minor_private, ch["challenge"].encode()),
    })
    ch = call("POST", "/api/auth/challenge", {"role": "voter", "username": "kid0142"})[1]
    minor_ballot_private, minor_ballot_public = crypto.generate_ed25519_keypair()
    status, refused = call("POST", "/api/elections/e3/enrol", {
        "ballot_public_key": minor_ballot_public,
        "sealed_ballot_key": seal(minor_ballot_private, "minor-ballot"),
        "challenge": ch["challenge"],
        "signature": crypto.sign_message(minor_private, ch["challenge"].encode()),
    })
    check("refused with 403", status == 403, f"{status} {refused}")
    check("the message states the rule", "18" in refused.get("detail", ""), json.dumps(refused))
    check("the message never states their age", MINOR_DOB[:4] not in json.dumps(refused),
          json.dumps(refused))
    status, mine_minor = call("GET", "/api/me/elections")
    check("the dashboard knows it is ineligible",
          all(row["eligible"] is False for row in mine_minor["elections"]),
          json.dumps(mine_minor)[:200])

    step("14. an admin can block a duplicate account")
    call("POST", "/api/auth/logout")
    call("POST", "/api/auth/admin/login", {"name": "admin", "passphrase": MASTER})
    status, blocked = call("POST", "/api/elections/e1/blocks",
                           {"username": "asharao0143", "reason": "duplicate account"})
    check("admin blocked an account (201)", status == 201, f"{status} {blocked}")
    status, listed = call("GET", "/api/elections/e1/blocks")
    check("the block is listed with its reason",
          any(b["username"] == "asharao0143" and b["reason"] == "duplicate account"
              for b in listed["blocks"]), json.dumps(listed))
    status, removed = call("DELETE", "/api/elections/e1/blocks/asharao0143")
    check("and can unblock one", status == 200, f"{status} {removed}")

    step("15. the served frontend bundle exists")
    dist = Path(__file__).resolve().parents[1] / "frontend" / "dist" / "index.html"
    check("frontend/dist/index.html built", dist.is_file(), str(dist))
finally:
    server.should_exit = True
    shutil.rmtree(SANDBOX, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED: {failures}")
    sys.exit(1)
print("walkthrough complete, every step green")
