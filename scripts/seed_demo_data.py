"""Fill a running dev server with realistic demo content.

ZetaVote ships with an empty database, which is correct for a product and useless
for looking at one. This creates three elections in the states the interface has
to handle, six accounts across them, a block, a finished and tallied election, and
a forty-entry audit chain — by talking to the running server over HTTP and doing
the browser's cryptography in Python.

It needs a server already running, and an admin account to sign in as:

    python run.py                       # terminal 1
    python scripts/seed_demo_data.py     # terminal 2

Pass --admin and --admin-passphrase if the admin is not `ada` / the passphrase
you set. The seeded voter passphrases are all `account-passphrase-2026` (account)
and `ballot-passphrase-2026` (per-election ballot key), so any of the accounts
can be signed into from the browser.

Refuses to overwrite: an election id that already exists is reported and skipped,
so a second run leaves a demo you have already voted in alone. Reset the database
by stopping the server and deleting data/elections.db.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend import crypto  # noqa: E402

BASE = "http://127.0.0.1:8080"
DB_PATH = PROJECT_ROOT / "data" / "elections.db"

MASTER = "master-passphrase-2026"
ACCOUNT_PASSPHRASE = "account-passphrase-2026"
BALLOT_PASSPHRASE = "ballot-passphrase-2026"

# name, date of birth, four digits they choose
VOTERS = [
    ("Asha Rao", "1996-03-12", "0142"),
    ("Ben Okafor", "1988-11-02", "7781"),
    ("Chandra Iyer", "1979-06-30", "3390"),
    ("Dana Whitfield", "2001-02-14", "5523"),
    ("Elif Demir", "1993-09-08", "6614"),
    # Enrolled in the finished election and never voted in it, so the dashboard
    # has a "missed" row and the published results are reachable.
    ("Femi Balogun", "1995-05-21", "4807"),
]

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with opener.open(request) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seal(private_key_b64: str, passphrase: str, cost: int) -> dict:
    """The AES-GCM blob the browser would have produced for a sealed key."""
    key, salt = crypto.derive_key_from_passphrase(passphrase, n=cost)
    blob = crypto.encrypt_bytes(crypto.unb64(private_key_b64), key)
    blob["salt"] = crypto.b64(salt)
    return blob


def build_ballot(
    election: dict, private_key: str, public_key: str, account: str, choice: str
) -> tuple[dict, str]:
    """The same bytes frontend/src/services/crypto.ts:buildVote produces."""
    election_id = election["id"]
    vote_nonce = crypto.b64(os.urandom(16))
    reveal_salt = crypto.b64(os.urandom(32))
    timestamp = now()
    plaintext = crypto.canonical_json(
        {
            "election_id": election_id,
            "voter_id": account,
            "voter_pubkey": public_key,
            "choice": choice,
            "vote_nonce": vote_nonce,
            "timestamp": timestamp,
        }
    )
    sealed = crypto.seal_with_public_key(plaintext.encode(), election["public_key"])
    row = {
        "election_id": election_id,
        "voter_id": account,
        "voter_pubkey": public_key,
        "ballot_id": crypto.ballot_id(election_id, public_key, vote_nonce),
        "commitment": crypto.ballot_commitment(election_id, public_key, reveal_salt, choice),
        "vote_nonce": vote_nonce,
        "timestamp": timestamp,
        "ephemeral_pub": sealed["ephemeral_pub"],
        "nonce": sealed["nonce"],
        "ciphertext": sealed["ciphertext"],
    }
    signed = crypto.sign_message(
        private_key, crypto.canonical_json(row).encode()
    )
    return {**row, "signature": signed}, reveal_salt


def make_account(name: str, dob: str, digits: str) -> tuple[str, str, str] | None:
    status, available = call(
        "GET", f"/api/accounts/available?name={name.replace(' ', '%20')}&digits={digits}"
    )
    if "username" not in available:
        print(f"  ! could not derive a username for {name}: {status} {available}")
        return None
    username = available["username"]
    private, public = crypto.generate_ed25519_keypair()
    sealed = seal(private, ACCOUNT_PASSPHRASE, crypto.SCRYPT_N_VOTER)
    status, _ = call(
        "POST",
        "/api/accounts",
        {
            "username": username,
            "name": name,
            "dob": dob,
            "public_key": public,
            "sealed_key": sealed,
        },
    )
    if status == 409:
        print(f"  · {username} already exists, leaving it alone")
        return None
    print(f"  · {username} ({status})")
    return username, private, public


def login_voter(username: str, private_key: str) -> int:
    call("POST", "/api/auth/logout")
    _, challenge = call("POST", "/api/auth/challenge", {"role": "voter", "username": username})
    return call(
        "POST",
        "/api/auth/voter/login",
        {
            "username": username,
            "challenge": challenge["challenge"],
            "signature": crypto.sign_message(private_key, challenge["challenge"].encode()),
        },
    )[0]


def enrol(election_id: str, account_key: str, ballot_key: str, ballot_public: str):
    who = call("GET", "/api/auth/me")[1]
    _, challenge = call(
        "POST", "/api/auth/challenge", {"role": "voter", "username": who["subject"]}
    )
    return call(
        "POST",
        f"/api/elections/{election_id}/enrol",
        {
            "ballot_public_key": ballot_public,
            "sealed_ballot_key": seal(ballot_key, BALLOT_PASSPHRASE, crypto.SCRYPT_N_VOTER),
            "challenge": challenge["challenge"],
            "signature": crypto.sign_message(account_key, challenge["challenge"].encode()),
        },
    )


def elections_for(now_dt: datetime) -> list[dict]:
    soon = (now_dt + timedelta(hours=2)).isoformat()
    later = (now_dt + timedelta(days=9)).isoformat()
    return [
        {
            "id": "election_2026",
            "name": "Student Union President",
            "description": "One seat. Everyone enrolled and aged 18 or over may cast one ballot.",
            "master_passphrase": MASTER,
            "candidates": ["Asha Rao", "Grace Chen", "Ibrahim Haddad"],
            "min_age": 18,
            "ends_at": soon,
        },
        {
            "id": "election_honours",
            "name": "Department Honours Board",
            "description": "Four seats. Closes in nine days.",
            "master_passphrase": MASTER,
            "candidates": [
                "Dr Amara Singh",
                "Dr Tomas Reiter",
                "Dr Lin Zhao",
                "Dr Peter Aylward",
            ],
            "min_age": 18,
            "ends_at": later,
        },
        {
            # Created with its window still open so people can join and vote; the
            # date is moved back afterwards, then closed and tallied.
            "id": "election_2025",
            "name": "Autumn Referendum",
            "description": "Closed and tallied. Kept here for the audit record.",
            "master_passphrase": MASTER,
            "candidates": ["Keep the 3-term rule", "Return to 2 terms"],
            "min_age": 18,
            "ends_at": later,
        },
    ]


def ballots_for() -> list[tuple[str, dict[str, str]]]:
    return [
        (
            "election_2026",
            {
                "asharao0142": "Asha Rao",
                "benokafor7781": "Grace Chen",
                "chandraiyer3390": "Ibrahim Haddad",
                "danawhitfield5523": "Grace Chen",
            },
        ),
        ("election_honours", {"asharao0142": "Dr Amara Singh"}),
        (
            "election_2025",
            {
                "asharao0142": "Return to 2 terms",
                "benokafor7781": "Keep the 3-term rule",
                "chandraiyer3390": "Keep the 3-term rule",
                "danawhitfield5523": "Return to 2 terms",
                "elifdemir6614": "Return to 2 terms",
            },
        ),
    ]


def backdate(election_id: str, now_dt: datetime) -> None:
    """Move a window into the past directly.

    The server only refuses an enrolment outside the window, so the honest way to
    make a finished election is to fill it while it is open and then move its
    dates. Voting through the API rather than editing rows keeps the hash chain
    intact and the audit log telling the truth.
    """
    connection = sqlite3.connect(DB_PATH)
    connection.execute(
        "UPDATE elections SET starts_at = ?, ends_at = ? WHERE id = ?",
        (
            (now_dt - timedelta(days=5)).isoformat(),
            (now_dt - timedelta(days=3)).isoformat(),
            election_id,
        ),
    )
    connection.commit()
    connection.close()


def main() -> int:
    global BASE

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--admin", default="ada")
    parser.add_argument("--admin-passphrase", required=True)
    parser.add_argument("--base", default=BASE)
    args = parser.parse_args()
    BASE = args.base

    status, _ = call(
        "POST",
        "/api/auth/admin/login",
        {"name": args.admin, "passphrase": args.admin_passphrase},
    )
    if status != 200:
        print(f"Could not sign in as {args.admin}: {status}", file=sys.stderr)
        return 1

    now_dt = datetime.now(timezone.utc)

    print("elections")
    for election in elections_for(now_dt):
        status, body = call("POST", "/api/elections", election)
        if status == 200:
            print(f"  · {election['id']} created")
        elif "already exists" in str(body):
            print(f"  · {election['id']} already exists, leaving it alone")
        else:
            print(f"  ! {election['id']}: {status} {body}")

    print("accounts")
    accounts: dict[str, tuple[str, str]] = {}
    for name, dob, digits in VOTERS:
        made = make_account(name, dob, digits)
        if made is not None:
            accounts[made[0]] = (made[1], made[2])

    print("enrolments and ballots")
    for election_id, choices in ballots_for():
        for username, (account_key, _public) in accounts.items():
            if login_voter(username, account_key) != 200:
                print(f"  ! could not sign in as {username}")
                continue
            ballot_key, ballot_public = crypto.generate_ed25519_keypair()
            status, body = enrol(election_id, account_key, ballot_key, ballot_public)
            if status != 201:
                print(f"  ! enrol {username} in {election_id}: {status} {str(body)[:80]}")
                continue
            if username in choices:
                detail = call("GET", f"/api/elections/{election_id}")[1]
                payload, _salt = build_ballot(
                    detail, ballot_key, ballot_public, username, choices[username]
                )
                status, body = call("POST", f"/api/elections/{election_id}/vote", payload)
                print(
                    f"  · {username} voted in {election_id}: {status}"
                    + ("" if status == 200 else f" {str(body)[:80]}")
                )

    print("closing the finished election")
    backdate("election_2025", now_dt)
    print("  close:", call("POST", "/api/elections/election_2025/close", {"master_passphrase": MASTER})[0])
    print("  tally:", call("POST", "/api/elections/election_2025/tally", {"master_passphrase": MASTER})[0])

    print("blocked accounts")
    # The last enrolment left a voter session behind, and blocking is admin-only.
    call(
        "POST",
        "/api/auth/admin/login",
        {"name": args.admin, "passphrase": args.admin_passphrase},
    )
    print(
        "  · elifdemir6614 in election_2026:",
        call(
            "POST",
            "/api/elections/election_2026/blocks",
            {
                "username": "elifdemir6614",
                "reason": "Suspected duplicate account — compare against asharao0142 in the audit log.",
            },
        )[0],
    )

    status, chain = call("GET", "/api/audit/verify")
    print(f"audit chain: valid={chain.get('valid')} entries={chain.get('entries')}")
    print()
    print("Sign in to the browser with any of:")
    for name, dob, digits in VOTERS:
        slug = "".join(ch for ch in name.lower() if ch.isalnum() or ch == " ")
        print(f"  {slug.replace(' ', '')}{digits}  /  {ACCOUNT_PASSPHRASE}")
    return 0 if status == 200 and chain.get("valid") else 1


if __name__ == "__main__":
    raise SystemExit(main())
