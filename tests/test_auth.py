"""Tests for the auth layer: nonces, sessions, rate limiting, credentials.

Written before the endpoints that use them. The properties checked here are the
ones that fail silently and only get noticed during an attack: a replayable
nonce, a sliding session that never expires, a limiter that resets on success.
"""

import time

from backend import auth
from backend.database import get_connection
from conftest import MASTER, make_voter_keys, register_account


# --------------------------------------------------------------------------
# Challenges
# --------------------------------------------------------------------------


def test_challenge_is_accepted_once_then_burned(anonymous_client):
    token = auth.issue_challenge("voter", "v1")
    assert auth.consume_challenge(token, "voter", "v1") is True
    # Replaying the same nonce must fail: this is the whole point of single use.
    assert auth.consume_challenge(token, "voter", "v1") is False


def test_unknown_challenge_is_rejected(anonymous_client):
    assert auth.consume_challenge("not-a-real-token", "voter", "v1") is False


def test_challenge_is_bound_to_its_subject(anonymous_client):
    token = auth.issue_challenge("voter", "v1")
    # A nonce issued for one voter must not authenticate another.
    assert auth.consume_challenge(token, "voter", "v2") is False


def test_challenge_is_bound_to_its_role(anonymous_client):
    token = auth.issue_challenge("voter", "v1")
    assert auth.consume_challenge(token, "admin", "v1") is False


def test_expired_challenge_is_rejected(anonymous_client):
    token = auth.issue_challenge("voter", "v1")
    # Backdate rather than sleeping: the TTL is 60s and tests should be fast.
    auth._challenges[token]["expires_at"] = time.time() - 1
    assert auth.consume_challenge(token, "voter", "v1") is False


def test_failed_challenge_check_still_consumes_the_nonce(anonymous_client):
    token = auth.issue_challenge("voter", "v1")
    assert auth.consume_challenge(token, "voter", "wrong-subject") is False
    # Burning on failure prevents an attacker from retrying the same nonce with
    # a different guess.
    assert auth.consume_challenge(token, "voter", "v1") is False


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------


def test_session_round_trips(anonymous_client):
    with get_connection() as conn:
        raw = auth.set_session(conn, "admin", "alice")
        assert auth.lookup_session(conn, raw)["subject"] == "alice"


def test_session_token_is_stored_hashed_not_raw(anonymous_client):
    with get_connection() as conn:
        raw = auth.set_session(conn, "admin", "alice")
        stored = conn.execute("SELECT token_hash FROM sessions").fetchone()["token_hash"]
    # The raw token must never be recoverable from the database.
    assert stored != raw
    assert stored == auth.hash_token(raw)


def test_unknown_session_token_resolves_to_none(anonymous_client):
    with get_connection() as conn:
        assert auth.lookup_session(conn, "forged") is None


def test_empty_session_token_resolves_to_none(anonymous_client):
    with get_connection() as conn:
        assert auth.lookup_session(conn, "") is None


def test_expired_session_is_rejected_and_deleted(anonymous_client):
    with get_connection() as conn:
        raw = auth.set_session(conn, "admin", "alice")
        conn.execute(
            "UPDATE sessions SET expires_at = ?", (int(time.time()) - 1,)
        )
        conn.commit()
        assert auth.lookup_session(conn, raw) is None
        # Expired rows are cleaned up, not left to accumulate.
        assert conn.execute("SELECT COUNT(*) AS n FROM sessions").fetchone()["n"] == 0


def test_logout_invalidates_the_session(anonymous_client):
    with get_connection() as conn:
        raw = auth.set_session(conn, "admin", "alice")
        assert auth.lookup_session(conn, raw) is not None
        auth.drop_session(conn, raw)
        assert auth.lookup_session(conn, raw) is None


def test_purge_removes_only_expired_sessions(anonymous_client):
    with get_connection() as conn:
        stale = auth.set_session(conn, "admin", "old")
        conn.execute("UPDATE sessions SET expires_at = ?", (int(time.time()) - 1,))
        conn.commit()
        fresh = auth.set_session(conn, "admin", "new")
        assert auth.purge_expired_sessions(conn) == 1
        assert auth.lookup_session(conn, fresh) is not None
        assert auth.lookup_session(conn, stale) is None


def test_session_expiry_is_absolute_not_sliding(anonymous_client):
    """An 8h session must not extend because the holder keeps using it."""
    with get_connection() as conn:
        raw = auth.set_session(conn, "admin", "alice")
        before = conn.execute("SELECT expires_at FROM sessions").fetchone()["expires_at"]
        # Activity does not touch expires_at; only creation sets it.
        auth.lookup_session(conn, raw)
        auth.lookup_session(conn, raw)
        after = conn.execute("SELECT expires_at FROM sessions").fetchone()["expires_at"]
    assert before == after


# --------------------------------------------------------------------------
# Rate limiting
# --------------------------------------------------------------------------


def test_rate_limiter_blocks_after_the_allowance(anonymous_client):
    auth.reset_rate_limits()
    for _ in range(auth._MAX_ATTEMPTS):
        assert auth.rate_limited("admin", "alice") is False
        auth.record_attempt("admin", "alice")
    assert auth.rate_limited("admin", "alice") is True


def test_rate_limit_is_scoped_per_identifier(anonymous_client):
    auth.reset_rate_limits()
    for _ in range(auth._MAX_ATTEMPTS + 2):
        auth.record_attempt("admin", "alice")
    # One caller exhausting their allowance must not lock out a different one.
    assert auth.rate_limited("admin", "alice") is True
    assert auth.rate_limited("admin", "bob") is False


def test_rate_limit_is_scoped_per_role(anonymous_client):
    auth.reset_rate_limits()
    for _ in range(auth._MAX_ATTEMPTS + 2):
        auth.record_attempt("voter", "v1")
    assert auth.rate_limited("voter", "v1") is True
    assert auth.rate_limited("admin", "v1") is False


def test_rate_limit_window_expires(anonymous_client):
    auth.reset_rate_limits()
    for _ in range(auth._MAX_ATTEMPTS + 2):
        auth.record_attempt("admin", "alice")
    assert auth.rate_limited("admin", "alice") is True
    # Age every recorded attempt past the window.
    auth._attempts["admin:alice"] = [time.monotonic() - auth._WINDOW_SECONDS - 1]
    assert auth.rate_limited("admin", "alice") is False


def test_successful_auth_clears_the_counter(anonymous_client):
    auth.reset_rate_limits()
    for _ in range(3):
        auth.record_attempt("admin", "alice")
    auth.clear_attempts("admin", "alice")
    # Otherwise a user who fumbles a few times and then succeeds would stay
    # throttled for the rest of the window.
    assert auth.rate_limited("admin", "alice") is False


# --------------------------------------------------------------------------
# Admin credentials
# --------------------------------------------------------------------------


def test_admin_verifier_is_not_the_passphrase(anonymous_client):
    salt, verifier = auth.make_admin_verifier(MASTER)
    assert verifier != MASTER
    assert salt != MASTER


def test_admin_verifier_round_trips(anonymous_client):
    salt, verifier = auth.make_admin_verifier(MASTER)
    assert auth.check_admin_verifier(MASTER, salt, verifier) is True
    assert auth.check_admin_verifier("wrong-passphrase", salt, verifier) is False


def test_same_passphrase_yields_different_verifiers(anonymous_client):
    """Distinct salts, so identical passphrases are not detectable by comparison."""
    _, first = auth.make_admin_verifier(MASTER)
    _, second = auth.make_admin_verifier(MASTER)
    assert first != second


# --------------------------------------------------------------------------
# Bootstrap
# --------------------------------------------------------------------------


def test_bootstrap_reports_pending_before_any_admin(anonymous_client):
    body = anonymous_client.get("/api/auth/bootstrap").json()
    assert body["needs_bootstrap"] is True
    assert body["code"]


def test_bootstrap_creates_the_first_admin(anonymous_client):
    code = auth.bootstrap_code()
    response = anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": "a-long-enough-passphrase", "code": code},
    )
    assert response.status_code == 200, response.text
    with get_connection() as conn:
        assert auth.find_admin(conn, "alice") is not None


def test_bootstrap_refuses_a_wrong_code(anonymous_client):
    response = anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": "a-long-enough-passphrase", "code": "wrong"},
    )
    assert response.status_code == 403
    with get_connection() as conn:
        assert auth.admin_count(conn) == 0


def test_bootstrap_is_single_use(anonymous_client):
    """A leaked console log must not allow a second account to be created."""
    code = auth.bootstrap_code()
    assert anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": "a-long-enough-passphrase", "code": code},
    ).status_code == 200
    assert anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "mallory", "passphrase": "another-long-passphrase", "code": code},
    ).status_code == 400
    with get_connection() as conn:
        assert auth.find_admin(conn, "mallory") is None


def test_bootstrap_enforces_a_passphrase_floor(anonymous_client):
    response = anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": "short", "code": auth.bootstrap_code()},
    )
    assert response.status_code == 422


def test_bootstrap_status_is_quiet_once_an_admin_exists(anonymous_client):
    anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": "a-long-enough-passphrase", "code": auth.bootstrap_code()},
    )
    body = anonymous_client.get("/api/auth/bootstrap").json()
    assert body == {"needs_bootstrap": False}


# --------------------------------------------------------------------------
# Admin login
# --------------------------------------------------------------------------


def test_admin_login_succeeds_with_correct_credentials(anonymous_client):
    anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": MASTER, "code": auth.bootstrap_code()},
    )
    response = anonymous_client.post("/api/auth/admin/login", json={"name": "alice", "passphrase": MASTER})
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "admin"


def test_admin_login_rejects_a_wrong_passphrase(anonymous_client):
    anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": MASTER, "code": auth.bootstrap_code()},
    )
    assert anonymous_client.post("/api/auth/admin/login", json={"name": "alice", "passphrase": "nope"}).status_code == 401


def test_admin_login_does_not_leak_whether_the_account_exists(anonymous_client):
    anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": MASTER, "code": auth.bootstrap_code()},
    )
    unknown = anonymous_client.post("/api/auth/admin/login", json={"name": "nobody", "passphrase": MASTER})
    wrong = anonymous_client.post("/api/auth/admin/login", json={"name": "alice", "passphrase": "nope"})
    # Identical status and detail, so the endpoint cannot enumerate admin names.
    assert unknown.status_code == wrong.status_code
    assert unknown.json() == wrong.json()


def test_admin_login_is_rate_limited(anonymous_client):
    anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": MASTER, "code": auth.bootstrap_code()},
    )
    for _ in range(auth._MAX_ATTEMPTS):
        anonymous_client.post("/api/auth/admin/login", json={"name": "alice", "passphrase": "wrong"})
    throttled = anonymous_client.post("/api/auth/admin/login", json={"name": "alice", "passphrase": MASTER})
    assert throttled.status_code == 429


def test_successful_login_sets_an_httponly_strict_cookie(anonymous_client):
    anonymous_client.post(
        "/api/auth/bootstrap",
        json={"name": "alice", "passphrase": MASTER, "code": auth.bootstrap_code()},
    )
    response = anonymous_client.post("/api/auth/admin/login", json={"name": "alice", "passphrase": MASTER})
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    # Strict is the CSRF defence: a cross-site request never carries the cookie.
    assert "SameSite=strict" in cookie.replace("SameSite=Strict", "SameSite=strict")


def test_me_reports_the_signed_in_admin(client):
    body = client.get("/api/auth/me").json()
    assert body == {"signed_in": True, "role": "admin", "subject": "test-admin"}


def test_me_reports_signed_out_without_a_cookie(anonymous_client):
    assert anonymous_client.get("/api/auth/me").json() == {"signed_in": False}


def test_logout_clears_the_session(client):
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").json() == {"signed_in": False}


# --------------------------------------------------------------------------
# Voter challenge-response
# --------------------------------------------------------------------------


def sign(private_key: str, message: bytes) -> str:
    from backend.crypto import sign_message

    return sign_message(private_key, message)


def test_voter_login_requires_a_signature_not_a_passphrase(client):
    """The wire format has no passphrase field at all, by design."""
    private_key, public_key, _sealed = register_account(client, "asha0142")

    challenge = client.post(
        "/api/auth/challenge", json={"role": "voter", "username": "asha0142"}
    ).json()["challenge"]
    response = client.post(
        "/api/auth/voter/login",
        json={
            "username": "asha0142",
            "challenge": challenge,
            "signature": sign(private_key, challenge.encode()),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["role"] == "voter"
    assert body["username"] == "asha0142"


def test_voter_login_rejects_a_signature_from_the_wrong_key(client):
    _private, public_key, _sealed = register_account(client, "asha0142")
    impostor_private, _public, _sealed = make_voter_keys("impostor-pass")
    challenge = client.post(
        "/api/auth/challenge", json={"role": "voter", "username": "asha0142"}
    ).json()["challenge"]
    response = client.post(
        "/api/auth/voter/login",
        json={
            "username": "asha0142",
            "challenge": challenge,
            "signature": sign(impostor_private, challenge.encode()),
        },
    )
    assert response.status_code == 401


def test_voter_challenge_cannot_be_replayed(client):
    private_key, public_key, _sealed = register_account(client, "asha0142")
    challenge = client.post(
        "/api/auth/challenge", json={"role": "voter", "username": "asha0142"}
    ).json()["challenge"]
    body = {
        "username": "asha0142",
        "challenge": challenge,
        "signature": sign(private_key, challenge.encode()),
    }
    assert client.post("/api/auth/voter/login", json=body).status_code == 200
    # The nonce is spent, so the same captured response is worthless.
    assert client.post("/api/auth/voter/login", json=body).status_code == 401


def test_voter_login_rejects_an_unknown_account(client):
    challenge = client.post(
        "/api/auth/challenge", json={"role": "voter", "username": "nobody0142"}
    ).json()["challenge"]
    response = client.post(
        "/api/auth/voter/login",
        json={"username": "nobody0142", "challenge": challenge, "signature": "x"},
    )
    assert response.status_code == 404


def test_voter_login_does_not_fold_the_case_of_a_username(client):
    """Usernames are case-sensitive, so a wrong-case sign-in fails instead of
    silently resolving to the account the user meant."""
    private_key, public_key, _sealed = register_account(client, "asha0142")
    challenge = client.post(
        "/api/auth/challenge", json={"role": "voter", "username": "asha0142"}
    ).json()["challenge"]
    response = client.post(
        "/api/auth/voter/login",
        json={
            "username": "Asha0142",
            "challenge": challenge,
            "signature": sign(private_key, challenge.encode()),
        },
    )
    assert response.status_code in (400, 404)


def test_a_challenge_minted_for_one_account_cannot_sign_in_as_another(client):
    """The nonce is bound to the account it was issued for, so a captured
    signature cannot be replayed against someone else's username."""
    private_key, _public, _sealed = register_account(client, "asha0142")
    register_account(client, "raman0142")
    challenge = client.post(
        "/api/auth/challenge", json={"role": "voter", "username": "asha0142"}
    ).json()["challenge"]
    response = client.post(
        "/api/auth/voter/login",
        json={
            "username": "raman0142",
            "challenge": challenge,
            "signature": sign(private_key, challenge.encode()),
        },
    )
    assert response.status_code == 401


def test_voter_challenge_requires_a_username(client):
    response = client.post("/api/auth/challenge", json={"role": "voter"})
    assert response.status_code == 400


def test_challenge_role_is_validated(client):
    assert client.post("/api/auth/challenge", json={"role": "root"}).status_code == 422
