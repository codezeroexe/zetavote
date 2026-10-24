"""Fill an empty ZetaVote data folder with demo accounts and elections.

Run from the project root with the server stopped and `data/` absent or empty:

    python scripts/seed_demo.py

Everything goes through the real API in-process, with the same client-side
crypto the browser uses (the Python twin in backend/crypto.py at full scrypt
cost), so every seeded account can sign in from the browser afterwards.
The credentials are listed in DEMO_ACCOUNTS.md.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402

if config.DB_PATH.exists():
    sys.exit(
        f"{config.DB_PATH} already exists. Move or delete the data/ folder first, "
        "then run this again. Seeding never touches existing data."
    )

from fastapi.testclient import TestClient  # noqa: E402

from backend import auth, crypto  # noqa: E402
from backend.app import app  # noqa: E402
from backend.database import get_connection  # noqa: E402

ADMIN_NAME = "Demo Admin"
ADMIN_PASS = "demo-admin-pass"
MASTER = "demo-master-pass"
ACCOUNT_PASS = "demo-voter-pass"
BALLOT_PASS = "demo-ballot-pass"

VOTERS = [
    # username, legal name, date of birth
    ("asharao0142", "Asha Rao", "1996-03-12"),
    ("benokafor0007", "Ben Okafor", "2001-07-21"),
    ("chenwei1234", "Chen Wei", "1988-11-02"),
    ("danasilva0311", "Dana Silva", "2010-05-05"),  # under 18
    ("elifkaya0420", "Elif Kaya", "1999-01-30"),
    ("farahhaddad0815", "Farah Haddad", "2003-09-14"),
]


def iso(days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def sealed(passphrase: str) -> tuple[str, str, dict[str, str]]:
    private_key, public_key = crypto.generate_ed25519_keypair()
    key, salt = crypto.derive_key_from_passphrase(passphrase)
    blob = crypto.encrypt_bytes(crypto.unb64(private_key), key)
    return private_key, public_key, {"salt": crypto.b64(salt), "nonce": blob["nonce"], "ciphertext": blob["ciphertext"]}


def ok(response, *codes: int) -> dict:
    if response.status_code not in (codes or (200, 201)):
        sys.exit(f"{response.request.method} {response.request.url} -> {response.status_code}: {response.text}")
    return response.json()


client = TestClient(app)
account_keys: dict[str, str] = {}
ballot_keys: dict[tuple[str, str], tuple[str, str]] = {}


def as_admin() -> None:
    ok(client.post("/api/auth/admin/login", json={"name": ADMIN_NAME, "passphrase": ADMIN_PASS}))


def sign_in(username: str) -> None:
    challenge = ok(client.post("/api/auth/challenge", json={"role": "voter", "username": username}))["challenge"]
    ok(client.post("/api/auth/voter/login", json={
        "username": username,
        "challenge": challenge,
        "signature": crypto.sign_message(account_keys[username], challenge.encode()),
    }))


def join(election_id: str, username: str) -> None:
    sign_in(username)
    private_key, public_key, blob = sealed(BALLOT_PASS)
    challenge = ok(client.post("/api/auth/challenge", json={"role": "voter", "username": username}))["challenge"]
    ok(client.post(f"/api/elections/{election_id}/enrol", json={
        "ballot_public_key": public_key,
        "sealed_ballot_key": blob,
        "challenge": challenge,
        "signature": crypto.sign_message(account_keys[username], challenge.encode()),
    }), 201)
    ballot_keys[(election_id, username)] = (private_key, public_key)


def vote(election_id: str, username: str, choice: str) -> None:
    if (election_id, username) not in ballot_keys:
        join(election_id, username)
    else:
        sign_in(username)
    private_key, public_key = ballot_keys[(election_id, username)]
    election = ok(client.get(f"/api/elections/{election_id}"))
    nonce = crypto.b64(os.urandom(16))
    salt = crypto.b64(os.urandom(32))
    ts = iso(0)
    plaintext = crypto.canonical_json({
        "election_id": election_id, "voter_id": username, "voter_pubkey": public_key,
        "choice": choice, "vote_nonce": nonce, "timestamp": ts,
    })
    box = crypto.seal_with_public_key(plaintext.encode(), election["public_key"])
    row = {
        "election_id": election_id, "voter_id": username, "voter_pubkey": public_key,
        "ballot_id": crypto.ballot_id(election_id, public_key, nonce),
        "commitment": crypto.ballot_commitment(election_id, public_key, salt, choice),
        "vote_nonce": nonce, "timestamp": ts,
        "ephemeral_pub": box["ephemeral_pub"], "nonce": box["nonce"], "ciphertext": box["ciphertext"],
    }
    row["signature"] = crypto.sign_message(private_key, crypto.canonical_json(row).encode())
    ok(client.post(f"/api/elections/{election_id}/vote", json=row))


def create(election_id: str, name: str, candidates: list[str], *, days: float, min_age: int | None = None,
           description: str | None = None) -> None:
    as_admin()
    ok(client.post("/api/elections", json={
        "id": election_id, "name": name, "description": description,
        "starts_at": iso(-1), "ends_at": iso(days),
        "master_passphrase": MASTER, "candidates": candidates, "min_age": min_age,
    }))


def finish(election_id: str, *, count: bool) -> None:
    as_admin()
    ok(client.post(f"/api/elections/{election_id}/close", json={"master_passphrase": MASTER}))
    if count:
        ok(client.post(f"/api/elections/{election_id}/tally", json={"master_passphrase": MASTER}))


def main() -> None:
    print("Seeding demo data (full-strength key derivation, takes about a minute)...")
    with get_connection() as conn:
        auth.create_admin(conn, ADMIN_NAME, ADMIN_PASS)
        conn.commit()

    for username, name, dob in VOTERS:
        private_key, public_key, blob = sealed(ACCOUNT_PASS)
        ok(client.post("/api/accounts", json={
            "username": username, "name": name, "dob": dob, "public_key": public_key, "sealed_key": blob,
        }), 201)
        account_keys[username] = private_key
        print(f"  account {username}")

    # Results out: everyone voted, closed and counted.
    create("club-budget-2026", "Club budget 2026", ["Sports kit", "Library books", "Music room"], days=0.5,
           description="How should this year's club budget be spent?")
    for username, choice in [("asharao0142", "Library books"), ("benokafor0007", "Sports kit"),
                             ("chenwei1234", "Library books"), ("elifkaya0420", "Music room"),
                             ("farahhaddad0815", "Library books")]:
        vote("club-budget-2026", username, choice)
    finish("club-budget-2026", count=True)
    print("  club-budget-2026: counted")

    # Ready to count: closed, not yet counted. Demo the admin's Count votes step.
    create("sports-day-2026", "Sports day date", ["Friday 14 Nov", "Saturday 15 Nov"], days=0.5)
    for username, choice in [("benokafor0007", "Saturday 15 Nov"), ("chenwei1234", "Friday 14 Nov"),
                             ("elifkaya0420", "Saturday 15 Nov")]:
        vote("sports-day-2026", username, choice)
    finish("sports-day-2026", count=False)
    print("  sports-day-2026: closed, ready to count")

    # Open, 16+: some voted, Asha joined but has not voted, others not joined.
    create("student-council-2026", "Student council 2026", ["Priya N.", "Tom R.", "Abstain"], days=7,
           min_age=16, description="Elect this year's student council lead.")
    for username, choice in [("benokafor0007", "Priya N."), ("chenwei1234", "Tom R."),
                             ("farahhaddad0815", "Priya N.")]:
        vote("student-council-2026", username, choice)
    join("student-council-2026", "asharao0142")
    print("  student-council-2026: open")

    # Open, 18+: Dana (under 18) sees it as not eligible.
    create("library-hours-2026", "Library hours", ["Open until 22:00", "Open until 20:00", "Keep as is"], days=10,
           min_age=18)
    vote("library-hours-2026", "farahhaddad0815", "Open until 22:00")
    print("  library-hours-2026: open, 18+")

    client.post("/api/auth/logout")
    print("Done. Sign-in details are in DEMO_ACCOUNTS.md.")


if __name__ == "__main__":
    main()
