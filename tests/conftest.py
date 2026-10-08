"""Shared fixtures plus a Python stand-in for the browser.

Everything the server accepts is produced here client-side, so these tests
double as the reference implementation of what frontend/src/crypto.ts must do.
If a signature stops verifying, the bug is almost always in this file or its
TypeScript twin, not in the endpoint.
"""

import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402

# Hermetic by construction, and before anything touches the real files.
# config.py resolves its paths at import time and the rest of the package copies
# them into its own namespace, so all four modules have to be redirected here —
# ahead of importing backend.app, which calls init_db() on import. Otherwise
# running the suite opens, migrates and then *deletes* a developer's actual
# data/elections.db, which is what `reset_project_state` used to do.
_SANDBOX = Path(tempfile.mkdtemp(prefix="zetavote-tests-"))
config.DATA_DIR = _SANDBOX
config.DB_PATH = _SANDBOX / "elections.db"
config.AUDIT_LOG_PATH = _SANDBOX / "votes_audit.log"
config.KEYS_DIR = _SANDBOX / "keys"

from backend import audit as audit_module  # noqa: E402
from backend import crypto  # noqa: E402
from backend import database as database_module  # noqa: E402

for _module in (database_module, audit_module):
    _module.DATA_DIR = _SANDBOX
    _module.DB_PATH = config.DB_PATH
    _module.AUDIT_LOG_PATH = config.AUDIT_LOG_PATH
    _module.KEYS_DIR = config.KEYS_DIR

MASTER = "master-passphrase"


ADMIN_NAME = "test-admin"

# scrypt dominates the suite's runtime, so the tests run it at a cost low
# enough to be quick. Nothing else is relaxed: the same code paths, the same
# sealed-key and verifier round trips, just a cheaper derivation. Anything that
# pins a real browser vector must clear this (see test_crypto_parity.py).
TEST_SCRYPT_N = int(os.environ.get("ZV_TEST_SCRYPT_N", "4096"))


@pytest.fixture(autouse=True, scope="session")
def cheap_scrypt_for_tests():
    previous = crypto.TEST_SCRYPT_N
    crypto.TEST_SCRYPT_N = TEST_SCRYPT_N
    yield
    crypto.TEST_SCRYPT_N = previous


@pytest.fixture(autouse=True)
def reset_project_state():
    # Only the sandbox. The old version pointed this at ROOT/data, so running the
    # suite destroyed a real election history.
    paths = (_SANDBOX / "keys", config.DB_PATH, config.AUDIT_LOG_PATH)
    for path in paths:
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    # The rate limiter and challenge store are module-level, so they would
    # otherwise leak state between tests.
    from backend import auth

    auth.reset_rate_limits()
    auth._challenges.clear()
    yield
    for path in paths:
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    auth.reset_rate_limits()
    auth._challenges.clear()


@pytest.fixture()
def client():
    """A TestClient with a bootstrapped, signed-in admin.

    Creating an election became admin-gated in v4, so the default client is
    already authenticated. This keeps every existing test body unchanged — they
    still just call `make_election(client)` and never think about auth.

    Tests that exercise the gate itself use `anonymous_client` instead.
    """
    from backend import auth
    from backend.app import app

    test_client = TestClient(app)
    bootstrap = test_client.post(
        "/api/auth/bootstrap",
        json={"name": ADMIN_NAME, "passphrase": MASTER, "code": auth.bootstrap_code()},
    )
    assert bootstrap.status_code == 200, bootstrap.text
    login = test_client.post("/api/auth/admin/login", json={"name": ADMIN_NAME, "passphrase": MASTER})
    assert login.status_code == 200, login.text
    return test_client


@pytest.fixture()
def anonymous_client():
    """A TestClient with no session, for testing the auth gates themselves."""
    from backend.app import app

    return TestClient(app)


# ---------- client-side helpers ----------


# There is no roster any more. Eligibility is an age rule on the election, so a
# test handle maps to an account and nothing else — no name, no date of birth, no
# person to look up. An election with no age bounds admits everyone, so the
# default fixtures stay eligible and these tests stay about what they were always
# about.


def account_id(voter_id: str) -> str:
    """The account a test's voter id stands for.

    An account id is a username — a slug plus four digits — so a handle like
    "v1" or "secret-voter" cannot be one verbatim. Every helper funnels through
    here, so the translation lives in exactly one place.
    """
    return f"{re.sub(r'[^a-z0-9]', '', voter_id.lower()) or 'voter'}0000"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def close_window(client, election_id: str) -> None:
    """Move an election's window into the past, as if it had just ended.

    Needed by tests that must register while voting is still open and then
    check that the closed window refuses the ballot. Creating the election with
    a past window cannot express that, because registration is correctly shut
    once the window has closed.
    """
    from backend.database import get_connection

    with get_connection() as conn:
        conn.execute(
            "UPDATE elections SET ends_at = ? WHERE id = ?",
            ((datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(), election_id),
        )
        conn.commit()


def make_voter_keys(passphrase: str) -> tuple[str, str, dict[str, str]]:
    """Generate an Ed25519 voter keypair and seal it, exactly as the browser does."""
    private_key, public_key = crypto.generate_ed25519_keypair()
    key_material, salt = crypto.derive_key_from_passphrase(passphrase)
    encrypted = crypto.encrypt_bytes(crypto.unb64(private_key), key_material)
    return private_key, public_key, {
        "salt": crypto.b64(salt),
        "nonce": encrypted["nonce"],
        "ciphertext": encrypted["ciphertext"],
    }


def build_ballot(
    *,
    election_public_key: str,
    voter_private_key: str,
    voter_public_key: str,
    voter_id: str,
    election_id: str,
    choice: str,
    vote_nonce: str | None = None,
    reveal_salt: str | None = None,
    timestamp: str | None = None,
) -> tuple[dict[str, str], str]:
    """Produce a full vote payload. Returns (payload, reveal_salt).

    `voter_id` is a test handle, not a wire value: an account id is a username,
    so it is translated here. `voter_private_key` is the *ballot* key from the
    enrolment, not the account key, which is what makes ballots unlinkable
    across elections.
    """
    account = account_id(voter_id)
    vote_nonce = vote_nonce or crypto.b64(os.urandom(16))
    reveal_salt = reveal_salt or crypto.b64(os.urandom(32))
    timestamp = timestamp or now()

    plaintext = crypto.canonical_json({
        "election_id": election_id,
        "voter_id": account,
        "voter_pubkey": voter_public_key,
        "choice": choice,
        "vote_nonce": vote_nonce,
        "timestamp": timestamp,
    })

    sealed = crypto.seal_with_public_key(plaintext.encode("utf-8"), election_public_key)
    row = {
        "election_id": election_id,
        "voter_id": account,
        "voter_pubkey": voter_public_key,
        "ballot_id": crypto.ballot_id(election_id, voter_public_key, vote_nonce),
        "commitment": crypto.ballot_commitment(election_id, voter_public_key, reveal_salt, choice),
        "vote_nonce": vote_nonce,
        "timestamp": timestamp,
        "ephemeral_pub": sealed["ephemeral_pub"],
        "nonce": sealed["nonce"],
        "ciphertext": sealed["ciphertext"],
    }
    signature = crypto.sign_message(voter_private_key, crypto.canonical_json(row).encode("utf-8"))
    return {**row, "signature": signature}, reveal_salt


# Exactly the fields backend/app.py:signing_payload hashes, in the order the
# canonical_json call sorts them. Keep in step with that function.
SIGNED_FIELDS = (
    "election_id",
    "voter_id",
    "voter_pubkey",
    "ballot_id",
    "commitment",
    "vote_nonce",
    "timestamp",
    "ephemeral_pub",
    "nonce",
    "ciphertext",
)


def resign(payload: dict[str, str], private_key: str) -> dict[str, str]:
    """Re-sign after mutating a payload, so a test can isolate one check.

    Only SIGNED_FIELDS are covered, exactly as the server does — signing the
    whole payload would include the old signature field and never verify.
    """
    row = {field: payload[field] for field in SIGNED_FIELDS}
    return {**payload, "signature": crypto.sign_message(private_key, crypto.canonical_json(row).encode("utf-8"))}


# ---------- high level flows ----------


def as_admin(client):
    """Sign back in as the admin, and hand the client back so it can be chained.

    `register()` and `cast()` sign in as the account they enrol, because a voter
    session is what enrolment is authorised by — so a test that enrols and then
    goes on to call an admin-only endpoint has to restore the session itself.
    """
    response = client.post(
        "/api/auth/admin/login", json={"name": ADMIN_NAME, "passphrase": MASTER}
    )
    assert response.status_code == 200, response.text
    return client


def make_election(client, election_id: str = "e1", *, master: str = MASTER, **kwargs):
    body = {
        "id": election_id,
        "name": "Election",
        "master_passphrase": master,
        "candidates": kwargs.pop("candidates", ["Alice", "Bob"]),
        **kwargs,
    }
    response = client.post("/api/elections", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def register_account(
    client, username: str = "asha0142", *, name: str = "Asha Rao", dob: str = "1996-03-12"
) -> tuple[str, str, dict]:
    """Create a global account, exactly as the browser does. No election involved."""
    private_key, public_key, sealed = make_voter_keys("account-pass")
    response = client.post(
        "/api/accounts",
        json={
            "username": username,
            "name": name,
            "dob": dob,
            "public_key": public_key,
            "sealed_key": sealed,
        },
    )
    assert response.status_code == 201, response.text
    return private_key, public_key, sealed


def sign_in_as(client, username: str, private_key: str) -> None:
    """Username plus a signed challenge, exactly as the browser does it."""
    challenge = client.post(
        "/api/auth/challenge", json={"role": "voter", "username": username}
    ).json()["challenge"]
    response = client.post(
        "/api/auth/voter/login",
        json={
            "username": username,
            "challenge": challenge,
            "signature": crypto.sign_message(private_key, challenge.encode()),
        },
    )
    assert response.status_code == 200, response.text


def enrol(
    client,
    election_id: str,
    username: str = "asharao0142",
    *,
    name: str = "Asha Rao",
    dob: str = "1996-03-12",
    account_key: str | None = None,
    sign_in: bool = True,
    sign_request: bool = True,
    sign_with: str | None = None,
) -> tuple[object, str, str, dict]:
    """Create the account unless it already exists, then enrol it.

    Returns (response, ballot_private_key, ballot_public_key, request_body). The
    body is returned so a test can replay a signed request.
    """
    if account_key is None:
        account_key, _public, _sealed = register_account(client, username, name=name, dob=dob)
    if sign_in:
        sign_in_as(client, username, account_key)

    ballot_private, ballot_public, sealed = make_voter_keys("ballot-pass")
    body: dict = {
        "ballot_public_key": ballot_public,
        "sealed_ballot_key": sealed,
    }
    if sign_request:
        challenge = client.post(
            "/api/auth/challenge", json={"role": "voter", "username": username}
        ).json()["challenge"]
        body["challenge"] = challenge
        body["signature"] = crypto.sign_message(sign_with or account_key, challenge.encode())
    response = client.post(f"/api/elections/{election_id}/enrol", json=body)
    return response, ballot_private, ballot_public, body


def register(client, election_id: str, voter_id: str) -> tuple[str, str, str]:
    """Get `voter_id` ready to vote in this election: create the account, enrol
    it, and hand back the *ballot* key the enrolment minted.

    Returns (ballot_private_key, ballot_public_key, account_id). The ballot key
    is the one that signs and opens ballots; the account key is never used for
    either, which is what keeps one person's activity in two elections
    unlinkable.
    """
    username = account_id(voter_id)
    response, private_key, public_key, _body = enrol(
        client, election_id, username, name="Asha Rao", dob="1996-03-12"
    )
    assert response.status_code == 201, response.text
    return private_key, public_key, username


def cast(client, election_id: str, voter_id: str, choice: str, **kwargs) -> dict:
    election = client.get(f"/api/elections/{election_id}").json()
    private_key, public_key, _ = register(client, election_id, voter_id)
    payload, _salt = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id=voter_id,
        election_id=election_id,
        choice=choice,
        **kwargs,
    )
    response = client.post(f"/api/elections/{election_id}/vote", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def admin(client, election_id: str, master: str = MASTER) -> dict[str, str]:
    return {"master_passphrase": master}
