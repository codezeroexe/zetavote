"""Admins, sessions, one-time challenges, and rate limiting.

Three ideas hold this together.

An *admin* is a normal credential: a scrypt verifier in the database, checked
server-side. Nothing the server holds can be unsealed with it, so learning an
admin passphrase grants no capability the attacker did not already have.

A *voter* never authenticates with a passphrase. The server holds the voter's
sealed key, so a passphrase sent to the server would let the server unseal it
and forge ballots. Instead the server issues a single-use nonce, the browser
signs it with the Ed25519 key it already holds, and the server checks the
signature. The server sees proof, never the secret.

A *session* is a random token stored hashed. The raw token lives in an
HttpOnly, SameSite=Strict cookie, so page JavaScript cannot read it and a
cross-site form cannot attach it.
"""

import hmac
import os
import time

from .crypto import b64, scrypt_derive, sha256_hex, unb64

# Nonces are single-use and short-lived. A replayed signature is worthless once
# the nonce is consumed, so a stolen response cannot be reused.
CHALLENGE_TTL_SECONDS = 60
SESSION_TTL_SECONDS = 8 * 60 * 60
TOKEN_BYTES = 32
MIN_ADMIN_PASSPHRASE = 12

# Sliding-window limiter. In-process on purpose: this app is a single local
# server with no Redis, and a dependency to enforce "not too fast" would cost
# more than it buys. A restart clears the counters, which is acceptable for a
# local tool — the KDF cost is the real defence against offline guessing.
_MAX_ATTEMPTS = 8
_WINDOW_SECONDS = 300

_attempts: dict[str, list[float]] = {}


def _key(scope: str, identifier: str) -> str:
    return f"{scope}:{identifier}"


def rate_limited(scope: str, identifier: str) -> bool:
    """True when this caller has exhausted its allowance in the current window."""
    now = time.monotonic()
    bucket = _key(scope, identifier)
    recent = [t for t in _attempts.get(bucket, []) if now - t < _WINDOW_SECONDS]
    if len(recent) >= _MAX_ATTEMPTS:
        _attempts[bucket] = recent
        return True
    _attempts[bucket] = recent
    return False


def record_attempt(scope: str, identifier: str) -> None:
    """Count a failed attempt. Callers check rate_limited before authenticating."""
    _attempts.setdefault(_key(scope, identifier), []).append(time.monotonic())


def clear_attempts(scope: str, identifier: str) -> None:
    _attempts.pop(_key(scope, identifier), None)


def reset_rate_limits() -> None:
    _attempts.clear()


# --------------------------------------------------------------------------
# Challenges
# --------------------------------------------------------------------------

_challenges: dict[str, dict[str, object]] = {}


def issue_challenge(role: str, subject: str | None = None) -> str:
    """Mint a single-use nonce bound to a role, and optionally an account.

    `subject` binds a voter's challenge to their voter id, so a nonce obtained
    for one voter cannot be signed by another.
    """
    token = b64(os.urandom(TOKEN_BYTES))
    _prune_challenges()
    _challenges[token] = {
        "role": role,
        "subject": subject,
        "expires_at": time.time() + CHALLENGE_TTL_SECONDS,
    }
    return token


def consume_challenge(token: str, role: str, subject: str | None = None) -> bool:
    """Verify and burn a nonce. Returns False for unknown, expired, replayed,
    wrong-role, or wrong-subject challenges."""
    _prune_challenges()
    entry = _challenges.pop(token, None)
    if entry is None:
        return False
    if entry["expires_at"] < time.time():
        return False
    if entry["role"] != role:
        return False
    if entry["subject"] != subject:
        return False
    return True


def _prune_challenges() -> None:
    now = time.time()
    for token in [t for t, e in _challenges.items() if e["expires_at"] < now]:
        _challenges.pop(token, None)


# --------------------------------------------------------------------------
# Session tokens
# --------------------------------------------------------------------------


def new_token() -> tuple[str, str]:
    """Return (raw_token, token_hash). Only the hash is persisted."""
    raw = b64(os.urandom(TOKEN_BYTES))
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return sha256_hex(raw)


def token_matches(raw: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_token(raw), stored_hash)


def set_session(conn, role: str, subject: str) -> str:
    raw, token_hash = new_token()
    conn.execute(
        """
        INSERT INTO sessions (token_hash, role, subject, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (token_hash, role, subject, int(time.time()) + SESSION_TTL_SECONDS, int(time.time())),
    )
    conn.commit()
    return raw


def lookup_session(conn, raw: str) -> dict[str, object] | None:
    """Resolve a cookie to its session, or None if absent or expired.

    Expiry is checked here rather than in SQL so the comparison is identical to
    the one used when the row was written.
    """
    if not raw:
        return None
    row = conn.execute(
        "SELECT token_hash, role, subject, expires_at FROM sessions WHERE token_hash = ?",
        (hash_token(raw),),
    ).fetchone()
    if row is None:
        return None
    if row["expires_at"] < int(time.time()):
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (row["token_hash"],))
        conn.commit()
        return None
    return {"role": row["role"], "subject": row["subject"], "expires_at": row["expires_at"]}


def drop_session(conn, raw: str) -> None:
    if not raw:
        return
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(raw),))
    conn.commit()


def purge_expired_sessions(conn) -> int:
    cursor = conn.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
    conn.commit()
    return cursor.rowcount


# --------------------------------------------------------------------------
# Admin credentials
# --------------------------------------------------------------------------


# Admin verifiers are computed once at creation and checked on each login.
# Logins are far rarer than voter key unseals, so this takes the expensive tier.
# It must match the n used when checking, or no admin could ever log in.
ADMIN_SCRYPT_N = 2**18


def make_admin_verifier(passphrase: str, *, n: int = ADMIN_SCRYPT_N) -> tuple[str, str]:
    """Return (salt_b64, verifier_b64) for a new admin.

    The verifier is a scrypt output, so it is useless without the passphrase.
    Nothing reversible is stored.
    """
    salt = os.urandom(16)
    return b64(salt), b64(scrypt_derive(passphrase, salt, n=n))


def check_admin_verifier(passphrase: str, salt_b64: str, verifier_b64: str) -> bool:
    candidate = scrypt_derive(passphrase, unb64(salt_b64), n=ADMIN_SCRYPT_N)
    return hmac.compare_digest(candidate, unb64(verifier_b64))


def admin_count(conn) -> int:
    return conn.execute("SELECT COUNT(*) AS n FROM admins").fetchone()["n"]


def find_admin(conn, name: str):
    return conn.execute("SELECT * FROM admins WHERE name = ?", (name,)).fetchone()


def create_admin(conn, name: str, passphrase: str) -> None:
    salt, verifier = make_admin_verifier(passphrase)
    conn.execute(
        "INSERT INTO admins (id, name, salt, verifier) VALUES (?, ?, ?, ?)",
        (name, name, salt, verifier),
    )
    conn.commit()


# --------------------------------------------------------------------------
# First-admin bootstrap
# --------------------------------------------------------------------------

# Creating the first admin is a one-shot, irreversible privilege grant. The code
# is printed to the server console rather than accepted from the browser alone,
# because whoever opens the first browser tab on a shared machine would
# otherwise be able to claim the account. Requiring console access puts it on
# the same trust boundary as running the CLI against the database.
_bootstrap_token: str | None = None


def mint_bootstrap_code() -> str:
    """Mint the one-time code and print it. Only valid while no admin exists."""
    global _bootstrap_token
    _bootstrap_token = b64(os.urandom(TOKEN_BYTES))
    print(
        "\n"
        "  ZetaVote: no admin accounts exist yet.\n"
        f"  First-run code: {_bootstrap_token}\n"
        "  Enter this in the app to create the first admin. It is shown once.\n",
        flush=True,
    )
    return _bootstrap_token


def bootstrap_code() -> str:
    """The current code, minting one if needed. Used by the CLI and tests."""
    return _bootstrap_token if _bootstrap_token is not None else mint_bootstrap_code()


def check_bootstrap_code(candidate: str) -> bool:
    return _bootstrap_token is not None and hmac.compare_digest(candidate, _bootstrap_token)


def clear_bootstrap_code() -> None:
    global _bootstrap_token
    _bootstrap_token = None
