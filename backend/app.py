import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from cryptography.exceptions import InvalidTag
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import audit, auth, merkle
from .crypto import (
    SCRYPT_N_ELECTION,
    b64,
    ballot_id as compute_ballot_id,
    canonical_json,
    decrypt_bytes,
    derive_key_from_passphrase,
    encrypt_bytes,
    generate_x25519_keypair,
    open_with_private_key,
    sha256_hex,
    unb64,
    verify_passphrase,
    verify_signature,
)
from .database import get_connection, identity_salt, init_db
from .eligibility import MAX_PLAUSIBLE_AGE, criteria_hash, describe, meets_criteria
from .usernames import fingerprint, is_valid_username, slugify, suggest

init_db()

# Ballots whose client timestamp is further than this from server time are
# rejected. Bounds replay of a captured request without needing a nonce table.
REPLAY_WINDOW = timedelta(minutes=5)
MIN_PASSPHRASE = 8

app = FastAPI(title="ZetaVote", version="0.4.0")

SESSION_COOKIE = "zv_session"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["x-frame-options"] = "DENY"
    response.headers["referrer-policy"] = "no-referrer"
    response.headers["x-xss-protection"] = "1; mode=block"
    return response


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------


def current_session(request: Request) -> dict[str, object] | None:
    with get_connection() as conn:
        return auth.lookup_session(conn, request.cookies.get(SESSION_COOKIE, ""))


def require_session(request: Request) -> dict[str, object]:
    session = current_session(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return session


def require_admin(request: Request) -> dict[str, object]:
    session = require_session(request)
    if session["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return session


def set_session_cookie(response: Response, token: str) -> None:
    # HttpOnly keeps the token out of reach of page scripts, so an XSS bug
    # cannot read it. SameSite=Strict means a cross-site request never carries
    # it, which together with the JSON content-type requirement is the CSRF
    # defence — a cross-origin form cannot set application/json without a
    # preflight, and the cookie would not ride along regardless.
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="strict",
        secure=False,
        path="/",
        max_age=auth.SESSION_TTL_SECONDS,
    )


# --------------------------------------------------------------------------
# Wire models
# --------------------------------------------------------------------------


class ElectionCreateRequest(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    master_passphrase: str = Field(..., min_length=MIN_PASSPHRASE)
    # Fixed at creation and never editable, so the tally can only ever contain
    # names the admin chose.
    candidates: list[str] = Field(..., min_length=1)
    # Who may vote, as a rule rather than a list of people to upload. A NULL on
    # either side is no bound. Both None admits everyone, which is the honest
    # meaning of an open election.
    min_age: int | None = Field(None, ge=0, le=MAX_PLAUSIBLE_AGE)
    max_age: int | None = Field(None, ge=0, le=MAX_PLAUSIBLE_AGE)


class SealedBlob(BaseModel):
    salt: str
    nonce: str
    ciphertext: str


class VoteCastRequest(BaseModel):
    """Everything the client produces. The plaintext choice is absent by design:
    it only exists inside `ciphertext`."""

    voter_id: str = Field(..., min_length=1)
    voter_pubkey: str = Field(..., min_length=1)
    ballot_id: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    commitment: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    vote_nonce: str = Field(..., min_length=1)
    timestamp: str
    ephemeral_pub: str = Field(..., min_length=1)
    nonce: str = Field(..., min_length=1)
    ciphertext: str = Field(..., min_length=1)
    signature: str = Field(..., min_length=1)


class PassphraseRequest(BaseModel):
    master_passphrase: str = Field(..., min_length=1)


# --------------------------------------------------------------------------
# Auth wire models
# --------------------------------------------------------------------------


class BootstrapRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    passphrase: str = Field(..., min_length=auth.MIN_ADMIN_PASSPHRASE)
    code: str = Field(..., min_length=1)


class AdminLoginRequest(BaseModel):
    name: str = Field(..., min_length=1)
    passphrase: str = Field(..., min_length=1)


class BlockRequest(BaseModel):
    """Bar one account from one election. The reason is stored for the audit
    trail and shown to the admin, never to the account holder."""

    username: str = Field(..., min_length=1, max_length=64)
    reason: str | None = Field(None, max_length=280)


class EnrolRequest(BaseModel):
    """Meet the election's eligibility rule, with a ballot key minted for it.

    The request is signed with the *account* key, not the ballot key, because the
    server has no way to tell an honest browser from a stolen session cookie
    otherwise — and whoever holds the cookie could otherwise enrol the account
    with a ballot key only they hold the private half of.
    """

    ballot_public_key: str = Field(..., min_length=1)
    sealed_ballot_key: SealedBlob
    challenge: str = Field(..., min_length=1)
    signature: str = Field(..., min_length=1)


class ChallengeRequest(BaseModel):
    role: str = Field(..., pattern="^(voter|admin)$")
    username: str | None = None


class VoterLoginRequest(BaseModel):
    """Sign-in is a username and a signed nonce. There is no election id and no
    passphrase field, and neither can be added: the server never holds the
    account key, so a passphrase sent here would hand it the ability to forge
    ballots under this account."""

    username: str = Field(..., min_length=1)
    challenge: str = Field(..., min_length=1)
    signature: str = Field(..., min_length=1)


class AccountCreateRequest(BaseModel):
    """Create the one account a person has, for life.

    The username is a slug of the legal name plus four digits the person picks,
    because `Asha Rao` and `A Sha Rao` both slug to `asharao`. A collision is
    answered with alternatives rather than a refusal — the digits exist precisely
    because two real people can share a name.
    """

    username: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    dob: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    public_key: str = Field(..., min_length=1)
    sealed_key: SealedBlob


class RotateSealRequest(BaseModel):
    """Re-encrypt the same private key under a new passphrase.

    Signed with the currently held key, so the server can confirm the request
    came from the keyholder rather than from a session that was hijacked.
    """

    sealed_key: SealedBlob
    challenge: str = Field(..., min_length=1)
    signature: str = Field(..., min_length=1)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def window_open(election: sqlite3.Row) -> str | None:
    """None when voting is allowed, else the reason it is not."""
    if election["active"] != 1:
        return "Election is not active"
    current = datetime.now(timezone.utc)
    starts = parse_ts(election["starts_at"])
    ends = parse_ts(election["ends_at"])
    if starts and current < starts:
        return "Voting has not opened yet"
    if ends and current > ends:
        return "Voting has closed"
    return None


def registration_shut(election: sqlite3.Row) -> str | None:
    """None while a voter may still register, else the reason they cannot.

    Registration stays open until the window closes, so a voter may prepare
    ahead of the start. Only a closed window shuts it, and for the same reason
    the vote path checks it: a voter registered after the fact can never cast a
    countable ballot, yet still appears in the registered count, which would
    leave the published turnout impossible to reconcile against the voter list.
    """
    if election["active"] != 1:
        return "Election is not active"
    ends = parse_ts(election["ends_at"])
    if ends and datetime.now(timezone.utc) > ends:
        return "Voting has closed"
    return None


def unseal_election(conn: sqlite3.Connection, election_id: str, passphrase: str) -> tuple[sqlite3.Row, str]:
    """Return the election and its X25519 private key.

    A successful unseal is the proof of admin. Nothing about the passphrase is
    stored, so a wrong passphrase fails as an AES-GCM tag mismatch.
    """
    election = conn.execute("SELECT * FROM elections WHERE id = ?", (election_id,)).fetchone()
    if not election:
        raise HTTPException(status_code=404, detail="Election not found")

    sealed = json.loads(election["sealed_private_key"])
    # Must match the n used when the key was sealed in create_election, or the
    # derived key differs and the AES-GCM tag never matches.
    key_material = derive_key_from_passphrase(
        passphrase, unb64(sealed["salt"]), n=SCRYPT_N_ELECTION
    )[0]
    try:
        private_key = decrypt_bytes(sealed, key_material)
    except InvalidTag:
        raise HTTPException(status_code=401, detail="Invalid master passphrase") from None
    return election, b64(private_key)


def signing_payload(row: dict[str, str]) -> str:
    """The exact bytes a client signs. Every field here is public, so the
    server can verify the signature at submit time without ever reading the
    ballot plaintext. frontend/src/crypto.ts builds the identical object."""
    return canonical_json({
        "election_id": row["election_id"],
        "voter_id": row["voter_id"],
        "voter_pubkey": row["voter_pubkey"],
        "ballot_id": row["ballot_id"],
        "commitment": row["commitment"],
        "vote_nonce": row["vote_nonce"],
        "timestamp": row["timestamp"],
        "ephemeral_pub": row["ephemeral_pub"],
        "nonce": row["nonce"],
        "ciphertext": row["ciphertext"],
    })


def ballot_to_row(election_id: str, payload: VoteCastRequest) -> dict[str, str]:
    return {
        "election_id": election_id,
        "voter_id": payload.voter_id,
        "voter_pubkey": payload.voter_pubkey,
        "ballot_id": payload.ballot_id,
        "commitment": payload.commitment,
        "vote_nonce": payload.vote_nonce,
        "timestamp": payload.timestamp,
        "ephemeral_pub": payload.ephemeral_pub,
        "nonce": payload.nonce,
        "ciphertext": payload.ciphertext,
    }


def record_from_row(row: sqlite3.Row) -> dict[str, str]:
    """Rebuild a signing payload from a stored ballot.

    The primary key is stored as `id` but signed as `ballot_id`, and the column
    holding the signed timestamp is `ballot_timestamp`.
    """
    record = {key: row[key] for key in row.keys()}
    record["ballot_id"] = record.pop("id")
    record["timestamp"] = record.pop("ballot_timestamp")
    return record


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------


@app.get("/api/auth/bootstrap")
def bootstrap_status() -> dict[str, object]:
    """Whether the first admin still needs creating, and a code if so.

    The code is only issued when no admin exists. Once one does, this endpoint
    reveals nothing useful to an attacker.
    """
    with get_connection() as conn:
        remaining = auth.admin_count(conn) == 0
    if not remaining:
        return {"needs_bootstrap": False}
    return {"needs_bootstrap": True, "code": auth.bootstrap_code()}


@app.post("/api/auth/bootstrap")
def bootstrap(payload: BootstrapRequest) -> dict[str, object]:
    """Create the first admin. Refuses once any admin exists."""
    with get_connection() as conn:
        if auth.admin_count(conn) > 0:
            raise HTTPException(status_code=400, detail="An admin already exists")
    if not auth.check_bootstrap_code(payload.code):
        raise HTTPException(status_code=403, detail="Incorrect first-run code")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name must not be blank")

    with get_connection() as conn:
        if auth.find_admin(conn, payload.name) is not None:
            raise HTTPException(status_code=400, detail="That admin name is taken")
        auth.create_admin(conn, payload.name, payload.passphrase)
        # The code is single-use, so a leaked console log does not allow a
        # second account to be created.
        auth.clear_bootstrap_code()

    audit.append(
        timestamp=now_iso(),
        election_id="-",
        actor=payload.name,
        action="bootstrap-admin",
        detail="-",
        status="ok",
    )
    return {"status": "created", "name": payload.name}


@app.post("/api/auth/admin/login")
def admin_login(payload: AdminLoginRequest, response: Response) -> dict[str, object]:
    if auth.rate_limited("admin", payload.name):
        raise HTTPException(status_code=429, detail="Too many attempts, wait a few minutes")

    with get_connection() as conn:
        row = auth.find_admin(conn, payload.name)
        # Same response for unknown account and wrong passphrase, so the
        # endpoint cannot be used to enumerate admin names.
        if row is None or not verify_passphrase(
            payload.passphrase, row["salt"], row["verifier"], n=auth.ADMIN_SCRYPT_N
        ):
            auth.record_attempt("admin", payload.name)
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token = auth.set_session(conn, "admin", row["name"])
        auth.purge_expired_sessions(conn)

    auth.clear_attempts("admin", payload.name)
    set_session_cookie(response, token)
    return {"role": "admin", "name": payload.name}


@app.post("/api/auth/challenge")
def issue_challenge(payload: ChallengeRequest) -> dict[str, object]:
    """Mint a single-use nonce.

    For a voter it is bound to that account, so a nonce obtained for one account
    cannot be used to authenticate as another. No election is involved: an
    account outlives every election it ever votes in.
    """
    subject = payload.username if payload.role == "voter" else None
    if payload.role == "voter" and not subject:
        raise HTTPException(status_code=400, detail="A voter challenge needs a username")
    return {
        "challenge": auth.issue_challenge(payload.role, subject),
        "expires_in": auth.CHALLENGE_TTL_SECONDS,
    }


@app.post("/api/auth/voter/login")
def voter_login(payload: VoterLoginRequest, response: Response) -> dict[str, object]:
    """Exchange a signed challenge for a session.

    The account holder never sends a passphrase. The browser holds its private key
    and signs the nonce; the server checks the signature against the public key it
    already has. A passphrase sent to the server would let the server unseal the
    account key and forge ballots, so there is nowhere for one to go.
    """
    if auth.rate_limited("account", payload.username):
        raise HTTPException(status_code=429, detail="Too many attempts, wait a few minutes")

    with get_connection() as conn:
        account = conn.execute(
            "SELECT public_key FROM accounts WHERE id = ?", (payload.username,)
        ).fetchone()
        if account is None:
            auth.record_attempt("account", payload.username)
            raise HTTPException(status_code=404, detail="Unknown username")

    # Consume before verifying, so a wrong signature still burns the nonce.
    if not auth.consume_challenge(payload.challenge, "voter", payload.username):
        auth.record_attempt("account", payload.username)
        raise HTTPException(status_code=401, detail="Challenge is invalid or expired")

    if not verify_signature(
        account["public_key"], payload.challenge.encode("utf-8"), payload.signature
    ):
        auth.record_attempt("account", payload.username)
        raise HTTPException(status_code=401, detail="Signature does not verify")

    with get_connection() as conn:
        token = auth.set_session(conn, "voter", payload.username)
        auth.purge_expired_sessions(conn)
    auth.clear_attempts("account", payload.username)
    set_session_cookie(response, token)
    return {"role": "voter", "username": payload.username}


@app.post("/api/auth/rotate-seal")
def rotate_seal(payload: RotateSealRequest, request: Request) -> dict[str, object]:
    """Re-encrypt the same private key under a new passphrase.

    The private key is unchanged, so existing ballots stay verifiable against the
    same public key and the person does not have to re-register. The request is
    signed with the key they already hold, so a stolen session alone cannot
    rewrite it.
    """
    session = require_session(request)
    username = session["subject"]
    if session["role"] != "voter":
        raise HTTPException(status_code=403, detail="Voter access required")

    with get_connection() as conn:
        account = conn.execute(
            "SELECT public_key FROM accounts WHERE id = ?", (username,)
        ).fetchone()
        if account is None:
            raise HTTPException(status_code=404, detail="Unknown username")

    if not auth.consume_challenge(payload.challenge, "voter", username):
        raise HTTPException(status_code=401, detail="Challenge is invalid or expired")
    if not verify_signature(
        account["public_key"], payload.challenge.encode("utf-8"), payload.signature
    ):
        raise HTTPException(status_code=401, detail="Signature does not verify")

    with get_connection() as conn:
        conn.execute(
            "UPDATE accounts SET sealed_key = ? WHERE id = ?",
            (json.dumps(payload.sealed_key.model_dump(), sort_keys=True), username),
        )
        conn.commit()

    audit.append(
        timestamp=now_iso(),
        election_id="-",
        actor=sha256_hex(username)[:16],
        action="rotate-seal",
        detail=account["public_key"],
        status="ok",
    )
    return {"status": "rotated"}


@app.get("/api/auth/me")
def whoami(request: Request) -> dict[str, object]:
    session = current_session(request)
    if session is None:
        return {"signed_in": False}
    return {"signed_in": True, "role": session["role"], "subject": session["subject"]}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response) -> dict[str, str]:
    with get_connection() as conn:
        auth.drop_session(conn, request.cookies.get(SESSION_COOKIE, ""))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "signed out"}


# --------------------------------------------------------------------------
# Accounts — one per person, for life
# --------------------------------------------------------------------------

# How many alternatives to offer when a username is taken. Three is enough to
# show that other names exist without turning the form into a list.
SUGGESTION_COUNT = 3


def taken_usernames(conn) -> set[str]:
    return {row[0] for row in conn.execute("SELECT id FROM accounts")}


def alternatives_to(base: str, taken: set[str]) -> list[str]:
    """The next free usernames after `base`, walking forward from it.

    Deterministic, so the same person is offered the same names on a second
    attempt. A shorter list means the four-digit space is genuinely full.
    """
    found: list[str] = []
    current = base
    for _ in range(SUGGESTION_COUNT):
        nxt = suggest(current, taken)
        if nxt is None:
            break
        found.append(nxt)
        current = nxt
    return found


@app.get("/api/accounts/available")
def account_available(
    name: str = Query("", max_length=120), digits: str = Query("", max_length=8)
) -> dict[str, object]:
    """Is `slug(name) + digits` free, and if not, what is?

    The slug is computed here rather than in the browser so there is one
    implementation of the rules; the browser asks and renders the answer.
    Deliberately unauthenticated and unthrottled: username enumeration is not a
    concern for a local single-server tool, and probing for an existing name is
    exactly what someone registering legitimately has to do.

    An empty username means nothing could be composed from these inputs — either
    the name slugifies to nothing, or the digits are not four. The browser says
    so; there is nothing to suggest.
    """
    username = slugify(name) + digits.strip()
    if not is_valid_username(username):
        return {"username": "", "available": False, "suggestions": []}

    with get_connection() as conn:
        taken = taken_usernames(conn)
    if username not in taken:
        return {"username": username, "available": True, "suggestions": []}
    return {"username": username, "available": False, "suggestions": alternatives_to(username, taken)}


@app.post("/api/accounts", status_code=201)
def create_account(payload: AccountCreateRequest) -> object:
    """Create an account. Public, because anyone may register; a session is
    neither required nor useful here, and issuing one would mean this endpoint
    could be used to sign someone in without them unsealing anything.

    The passphrase that opens the sealed key never reaches this process, so the
    response cannot leak it and the server cannot use it to sign a ballot. A
    repeat name and date of birth only warns: a hard block would lock out twins
    and would not stop anyone who shifted their date of birth by a day.
    """
    if not is_valid_username(payload.username):
        raise HTTPException(
            status_code=400,
            detail="A username is a name and four digits, for example asharao0142",
        )

    with get_connection() as conn:
        taken = taken_usernames(conn)
        if payload.username in taken:
            # Answers with alternatives rather than refusing outright, so the
            # person picks new digits instead of concluding registration is closed.
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "That username is taken",
                    "username": payload.username,
                    "suggestions": alternatives_to(payload.username, taken),
                },
            )

        name_hash = fingerprint(payload.name, identity_salt(conn))
        clash = conn.execute(
            "SELECT COUNT(*) FROM accounts WHERE name_hash = ? AND dob = ?",
            (name_hash, payload.dob),
        ).fetchone()[0]

        try:
            conn.execute(
                """
                INSERT INTO accounts (id, name_hash, dob, public_key, sealed_key)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    payload.username,
                    name_hash,
                    payload.dob,
                    payload.public_key,
                    json.dumps(payload.sealed_key.model_dump(), sort_keys=True),
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Two registrations for the same username can both pass the lookup
            # above. The primary key is the authority, not the read.
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "That username is taken",
                    "username": payload.username,
                    "suggestions": alternatives_to(payload.username, taken),
                },
            )

    audit.append(
        timestamp=now_iso(),
        election_id="-",
        actor=sha256_hex(payload.username)[:16],
        action="create-account",
        detail=payload.public_key,
        status="ok",
    )
    return {
        "username": payload.username,
        "created_at": now_iso(),
        "suggestions": [],
        "warning": (
            "Another account already uses this name and date of birth. "
            "If that is you, sign in instead of registering again."
            if clash
            else None
        ),
    }


@app.get("/api/accounts/{username}/sealed-key")
def account_sealed_key(username: str) -> dict[str, object]:
    """Hand back the account's sealed key so another device can open it.

    Only ciphertext leaves the server. The browser unseals it locally with the
    passphrase, so this endpoint cannot impersonate the holder — but it does put a
    passphrase-protected blob on the wire, which makes it a password-guessing
    surface. It is therefore rate limited; the scrypt cost is what actually makes
    guessing expensive, since an attacker who takes the blob can work on it
    offline indefinitely.
    """
    if auth.rate_limited("sealed-key", username):
        raise HTTPException(status_code=429, detail="Too many attempts, wait a few minutes")

    with get_connection() as conn:
        account = conn.execute(
            "SELECT sealed_key FROM accounts WHERE id = ?", (username,)
        ).fetchone()
    if account is None:
        auth.record_attempt("sealed-key", username)
        raise HTTPException(status_code=404, detail="Unknown username")

    auth.clear_attempts("sealed-key", username)
    return {"username": username, "sealed_key": json.loads(account["sealed_key"])}


# --------------------------------------------------------------------------
# Blocked accounts — the admin's deny-list
# --------------------------------------------------------------------------


@app.get("/api/elections/{election_id}/blocks")
def list_blocks(election_id: str, request: Request) -> dict[str, object]:
    """Accounts barred from one election. Admin session required.

    A block names one account and leaves everyone else alone, so it cannot be used
    to lock out a whole birthdate or a whole name.
    """
    require_admin(request)
    with get_connection() as conn:
        if not conn.execute("SELECT id FROM elections WHERE id = ?", (election_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Election not found")
        blocks = [
            {"username": row["username"], "reason": row["reason"], "created_at": row["created_at"]}
            for row in conn.execute(
                "SELECT username, reason, created_at FROM election_blocks"
                " WHERE election_id = ? ORDER BY created_at, username",
                (election_id,),
            )
        ]
    return {"blocks": blocks}


@app.post("/api/elections/{election_id}/blocks", status_code=201)
def add_block(election_id: str, payload: BlockRequest, request: Request) -> dict[str, object]:
    """Bar an account from this election. Idempotent, because an admin clicking
    twice should not get an error dialog.

    This may name an account that does not exist yet, which is how a duplicate
    somebody already knows about is stopped before its next attempt.
    """
    require_admin(request)
    if not is_valid_username(payload.username):
        raise HTTPException(
            status_code=400, detail="A username is a name and four digits"
        )

    with get_connection() as conn:
        if not conn.execute("SELECT id FROM elections WHERE id = ?", (election_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Election not found")
        existing = conn.execute(
            "SELECT username FROM election_blocks WHERE election_id = ? AND username = ?",
            (election_id, payload.username),
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO election_blocks (election_id, username, reason) VALUES (?, ?, ?)",
                (election_id, payload.username, payload.reason),
            )
            conn.commit()
            created = True
        else:
            # Re-blocking with a new reason is an update, not a duplicate.
            conn.execute(
                "UPDATE election_blocks SET reason = ? WHERE election_id = ? AND username = ?",
                (payload.reason, election_id, payload.username),
            )
            conn.commit()
            created = False

    audit.append(
        timestamp=now_iso(),
        election_id=election_id,
        actor="admin",
        action="block-account",
        detail=payload.username,
        status="added" if created else "updated",
    )
    # Idempotent re-add answers 200 rather than 201; FastAPI needs the override
    # because the decorator fixes one status code for the whole route.
    if not created:
        return JSONResponse(
            status_code=200,
            content={"election_id": election_id, "username": payload.username, "created": False},
        )
    return {"election_id": election_id, "username": payload.username, "created": True}


@app.delete("/api/elections/{election_id}/blocks/{username}")
def remove_block(election_id: str, username: str, request: Request) -> dict[str, object]:
    """Un-bar an account.

    Blocking and unblocking govern joining, not counting. An account that already
    enrolled and already cast a ballot keeps both, because withdrawing a ballot
    after the fact is exactly the manipulation this app exists to make impossible.
    A block stops the next enrolment, not the one that happened yesterday.
    """
    require_admin(request)
    with get_connection() as conn:
        if not conn.execute("SELECT id FROM elections WHERE id = ?", (election_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Election not found")
        if not conn.execute(
            "SELECT username FROM election_blocks WHERE election_id = ? AND username = ?",
            (election_id, username),
        ).fetchone():
            raise HTTPException(status_code=404, detail="That account is not blocked")
        conn.execute(
            "DELETE FROM election_blocks WHERE election_id = ? AND username = ?",
            (election_id, username),
        )
        conn.commit()

    audit.append(
        timestamp=now_iso(),
        election_id=election_id,
        actor="admin",
        action="unblock-account",
        detail=username,
        status="ok",
    )
    return {"election_id": election_id, "username": username, "created": False}


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health")
def api_health() -> dict[str, str]:
    # min_passphrase is published so the browser validates against the same number
    # the server enforces. It was hardcoded as 8 in two client files, each with a
    # comment saying it had to match this constant — one change to the rule would
    # have silently left both forms accepting too-short input.
    return {"status": "ok", "min_passphrase": str(MIN_PASSPHRASE)}


# --------------------------------------------------------------------------
# Elections
# --------------------------------------------------------------------------


@app.post("/api/elections")
def create_election(payload: ElectionCreateRequest, request: Request) -> dict[str, object]:
    """Create an election. Admin session required.

    Candidates are fixed here and never change afterwards: a list that could be
    edited while voting is open would be indistinguishable from manipulation,
    however well it was logged.
    """
    require_admin(request)

    names = [c.strip() for c in payload.candidates if c.strip()]
    if not names:
        raise HTTPException(status_code=400, detail="At least one candidate is required")
    if len(set(names)) != len(names):
        raise HTTPException(status_code=400, detail="Candidate names must be unique")

    if payload.min_age is not None and payload.max_age is not None:
        if payload.min_age > payload.max_age:
            raise HTTPException(
                status_code=400,
                detail="min_age cannot be greater than max_age",
            )

    private_key, public_key = generate_x25519_keypair()
    # Election keys are unsealed a handful of times in their life, so the
    # expensive KDF tier is essentially free here.
    key_material, salt = derive_key_from_passphrase(payload.master_passphrase, n=SCRYPT_N_ELECTION)
    sealed = encrypt_bytes(unb64(private_key), key_material)
    sealed["salt"] = b64(salt)

    with get_connection() as conn:
        if conn.execute("SELECT id FROM elections WHERE id = ?", (payload.id,)).fetchone():
            raise HTTPException(status_code=400, detail="Election already exists")
        conn.execute(
            """
            INSERT INTO elections (id, name, description, active, starts_at, ends_at,
                                   public_key, sealed_private_key,
                                   min_age, max_age, criteria_hash)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.id,
                payload.name,
                payload.description,
                payload.starts_at,
                payload.ends_at,
                public_key,
                json.dumps(sealed, sort_keys=True),
                payload.min_age,
                payload.max_age,
                criteria_hash(payload.min_age, payload.max_age),
            ),
        )
        conn.executemany(
            "INSERT INTO candidates (election_id, name, ordinal) VALUES (?, ?, ?)",
            [(payload.id, name, index) for index, name in enumerate(names)],
        )
        conn.commit()

    audit.append(
        timestamp=now_iso(),
        election_id=payload.id,
        actor="admin",
        action="create",
        detail=public_key,
        status="ok",
    )

    return {
        "id": payload.id,
        "name": payload.name,
        "description": payload.description,
        "starts_at": payload.starts_at,
        "ends_at": payload.ends_at,
        "public_key": public_key,
        "candidates": names,
        "criteria": {"max_age": payload.max_age, "min_age": payload.min_age},
    }


@app.get("/api/elections")
def list_elections(request: Request) -> dict[str, object]:
    """Full election list including turnout. Admin session required.

    The public route is /api/elections/open, which carries no counts.
    """
    require_admin(request)
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT e.id, e.name, e.description, e.active, e.starts_at, e.ends_at, e.created_at,
                   (SELECT COUNT(*) FROM enrolments e2 WHERE e2.election_id = e.id) AS registered,
                   (SELECT COUNT(*) FROM ballots b WHERE b.election_id = e.id) AS ballots
            FROM elections e ORDER BY e.created_at DESC, e.id
            """
        ).fetchall()

    return {
        "elections": [
            {
                "id": r["id"],
                "name": r["name"],
                "description": r["description"],
                "active": bool(r["active"]),
                "starts_at": r["starts_at"],
                "ends_at": r["ends_at"],
                "created_at": r["created_at"],
                "registered": r["registered"],
                "ballots": r["ballots"],
                "turnout": (r["ballots"] / r["registered"]) if r["registered"] else None,
            }
            for r in rows
        ]
    }


@app.get("/api/elections/{election_id}")
def get_election(election_id: str) -> dict[str, object]:
    """Election detail for voters. Public, because they need the public key to
    seal their ballot and the candidate list to choose from.

    Counts are withheld while voting is open and included once it closes. Before
    v4 these were returned unconditionally to anyone, which was a live leak.
    """
    with get_connection() as conn:
        election = conn.execute("SELECT * FROM elections WHERE id = ?", (election_id,)).fetchone()
        if not election:
            raise HTTPException(status_code=404, detail="Election not found")
        candidates = [
            r["name"]
            for r in conn.execute(
                "SELECT name FROM candidates WHERE election_id = ? ORDER BY ordinal", (election_id,)
            )
        ]
        registered = conn.execute(
            "SELECT COUNT(*) FROM enrolments WHERE election_id = ?", (election_id,)
        ).fetchone()[0]
        ballots = conn.execute(
            "SELECT COUNT(*) FROM ballots WHERE election_id = ?", (election_id,)
        ).fetchone()[0]

    accepting = window_open(election) is None
    body: dict[str, object] = {
        "id": election["id"],
        "name": election["name"],
        "description": election["description"],
        "active": bool(election["active"]),
        "starts_at": election["starts_at"],
        "ends_at": election["ends_at"],
        "created_at": election["created_at"],
        "public_key": election["public_key"],
        "candidates": candidates,
        "accepting_votes": accepting,
        # The rule itself, not the answer to it. Publishing the age band is what
        # lets a voter see whether joining is worth anything before they join —
        # `eligible` in /api/me/elections stays scoped to their own date of birth.
        "criteria": {"min_age": election["min_age"], "max_age": election["max_age"]},
    }
    # Absent rather than zero while open: a 0 would read as "no one has voted"
    # and re-create exactly the pressure the hidden count avoids.
    if not accepting:
        body["registered"] = registered
        body["ballots"] = ballots
        body["turnout"] = (ballots / registered) if registered else None
    return body


# --------------------------------------------------------------------------
# Enrolment — one account, one ballot
# --------------------------------------------------------------------------


@app.post("/api/elections/{election_id}/enrol", status_code=201)
def enrol_account(election_id: str, payload: EnrolRequest, request: Request) -> dict[str, object]:
    """Join this election by meeting its rule, with a ballot key minted for it.

    The ballot key is never the account key. A key reused across elections would
    put the same value in two audit logs, and anyone holding both could then link
    one person's activity in elections that have nothing else in common.

    Eligibility used to be a claim on a named roster line, which is what stopped a
    second account for the same person getting a second ballot. It is now a rule,
    so the only thing left is the primary key: one account, one enrolment. A
    duplicate account can still vote, and `election_blocks` is the admin's only
    lever on that.
    """
    session = require_session(request)
    if session["role"] != "voter":
        raise HTTPException(status_code=403, detail="Voter access required")
    username = session["subject"]

    with get_connection() as conn:
        election = conn.execute("SELECT * FROM elections WHERE id = ?", (election_id,)).fetchone()
        if not election:
            raise HTTPException(status_code=404, detail="Election not found")
        # Same rule as always: preparing early is fine, joining a closed election
        # would break the published turnout.
        blocked_window = registration_shut(election)
        if blocked_window:
            raise HTTPException(status_code=400, detail=blocked_window)

        account = conn.execute("SELECT * FROM accounts WHERE id = ?", (username,)).fetchone()
        if not account:
            raise HTTPException(status_code=404, detail="Unknown username")

        # The signature comes before eligibility, so a replayed request is refused
        # on its own terms rather than depending on what has changed since, and the
        # nonce is burned either way.
        if not auth.consume_challenge(payload.challenge, "voter", username):
            raise HTTPException(status_code=401, detail="Challenge is invalid or expired")
        if not verify_signature(
            account["public_key"], payload.challenge.encode("utf-8"), payload.signature
        ):
            raise HTTPException(status_code=401, detail="Signature does not verify")

        if conn.execute(
            "SELECT 1 FROM election_blocks WHERE election_id = ? AND username = ?",
            (election_id, username),
        ).fetchone():
            raise HTTPException(
                status_code=403, detail="This account is blocked from this election"
            )

        if not meets_criteria(
            account["dob"], election["min_age"], election["max_age"], date.today()
        ):
            # States the rule, never the applicant's age: the response must not
            # become a way to confirm a birthdate this server now holds.
            raise HTTPException(
                status_code=403,
                detail=describe(election["min_age"], election["max_age"]),
            )

        try:
            conn.execute(
                """
                INSERT INTO enrolments (election_id, account_id, ballot_public_key,
                                        sealed_ballot_key)
                VALUES (?, ?, ?, ?)
                """,
                (
                    election_id,
                    username,
                    payload.ballot_public_key,
                    json.dumps(payload.sealed_ballot_key.model_dump(), sort_keys=True),
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Already enrolled in this election") from None
        conn.commit()

    audit.append(
        timestamp=now_iso(),
        election_id=election_id,
        actor=sha256_hex(username)[:16],
        action="enrol",
        detail=payload.ballot_public_key,
        status="ok",
    )
    return {"election_id": election_id, "username": username}


# --------------------------------------------------------------------------
# The voter's own elections
# --------------------------------------------------------------------------

@app.get("/api/me/elections")
def my_elections(request: Request) -> dict[str, object]:
    """Every election, from this voter's point of view.

    The `id = :me` predicates are the security property here: without them the
    query would answer whether any other voter registered or voted. :me comes
    from the session and never from the request, so a caller cannot ask about
    anyone else. Counts follow the same rule as the public detail endpoint.
    """
    session = require_session(request)
    # An admin name is not an account id. Without this, an admin session would
    # match no enrolment and be shown a dashboard of "not enrolled" everywhere.
    if session["role"] != "voter":
        raise HTTPException(status_code=403, detail="Voter access required")
    account = session["subject"]

    with get_connection() as conn:
        # Needed so the dashboard can say "not eligible for this one" instead of
        # offering a Join button that can only fail. The date of birth stays in
        # this function: only the yes/no answer goes back out.
        dob = conn.execute(
            "SELECT dob FROM accounts WHERE id = ?", (account,)
        ).fetchone()["dob"]
        rows = conn.execute(
            """
            SELECT e.id, e.name, e.description, e.starts_at, e.ends_at, e.active,
                   e.min_age, e.max_age,
                   (en.account_id IS NOT NULL) AS registered,
                   (b.id IS NOT NULL) AS voted,
                   (SELECT COUNT(*) FROM enrolments e2 WHERE e2.election_id = e.id) AS n_registered,
                   (SELECT COUNT(*) FROM ballots b2 WHERE b2.election_id = e.id) AS n_ballots
            FROM elections e
            LEFT JOIN enrolments en ON en.election_id = e.id AND en.account_id = ?
            LEFT JOIN ballots b ON b.election_id = e.id AND b.voter_id = ?
            ORDER BY e.created_at DESC, e.id
            """,
            (account, account),
        ).fetchall()

    elections = []
    for r in rows:
        accepting = window_open(r) is None
        item: dict[str, object] = {
            "id": r["id"],
            "name": r["name"],
            "description": r["description"],
            "starts_at": r["starts_at"],
            "ends_at": r["ends_at"],
            "registered": bool(r["registered"]),
            "voted": bool(r["voted"]),
            "accepting_votes": accepting,
            # Judged on the server, so the rule is the server's answer to give and
            # the browser never has to know this account's date of birth.
            "eligible": meets_criteria(dob, r["min_age"], r["max_age"], date.today()),
        }
        if not accepting:
            item["counts"] = {
                "registered": r["n_registered"],
                "ballots": r["n_ballots"],
                "turnout": (r["n_ballots"] / r["n_registered"]) if r["n_registered"] else None,
            }
        elections.append(item)

    return {"elections": elections}


# --------------------------------------------------------------------------
# Vote submission
# --------------------------------------------------------------------------


@app.post("/api/elections/{election_id}/vote")
def cast_vote(election_id: str, payload: VoteCastRequest) -> dict[str, object]:
    with get_connection() as conn:
        election = conn.execute("SELECT * FROM elections WHERE id = ?", (election_id,)).fetchone()
        if not election:
            raise HTTPException(status_code=404, detail="Election not found")

        blocked = window_open(election)
        if blocked:
            raise HTTPException(status_code=400, detail=blocked)

        # The enrolment is the whole authorisation check. Its ballot_public_key is
        # the account's key for this election and nothing else, so a ballot signed
        # with anything else fails here.
        enrolment = conn.execute(
            "SELECT ballot_public_key FROM enrolments WHERE election_id = ? AND account_id = ?",
            (election_id, payload.voter_id),
        ).fetchone()
        if not enrolment:
            raise HTTPException(status_code=404, detail="Not enrolled in this election")
        if enrolment["ballot_public_key"] != payload.voter_pubkey:
            raise HTTPException(status_code=400, detail="Ballot public key does not match the enrolment")

        if conn.execute(
            "SELECT id FROM ballots WHERE election_id = ? AND voter_id = ?", (election_id, payload.voter_id)
        ).fetchone():
            raise HTTPException(status_code=400, detail="Duplicate vote rejected")

        stamp = parse_ts(payload.timestamp)
        if stamp is None:
            raise HTTPException(status_code=400, detail="Malformed ballot timestamp")
        if abs(datetime.now(timezone.utc) - stamp) > REPLAY_WINDOW:
            raise HTTPException(status_code=400, detail="Ballot timestamp outside the accepted window")

        # The signature covers only public fields, so it can be checked here
        # without decrypting anything. This is what makes the ballot provably
        # the voter's rather than the server's.
        row = ballot_to_row(election_id, payload)
        if not verify_signature(
            enrolment["ballot_public_key"], signing_payload(row).encode("utf-8"), payload.signature
        ):
            raise HTTPException(status_code=400, detail="Invalid ballot signature")

        expected_id = compute_ballot_id(election_id, payload.voter_pubkey, payload.vote_nonce)
        if expected_id != payload.ballot_id:
            raise HTTPException(status_code=400, detail="Ballot id does not match its contents")

        try:
            conn.execute(
                """
                INSERT INTO ballots (id, election_id, voter_id, ephemeral_pub, nonce, ciphertext,
                                     commitment, signature, vote_nonce, ballot_timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.ballot_id,
                    election_id,
                    payload.voter_id,
                    payload.ephemeral_pub,
                    payload.nonce,
                    payload.ciphertext,
                    payload.commitment,
                    payload.signature,
                    payload.vote_nonce,
                    payload.timestamp,
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Primary key collision: a nonce this voter already used.
            raise HTTPException(status_code=400, detail="Duplicate vote rejected") from None

    audit.append(
        timestamp=now_iso(),
        election_id=election_id,
        actor=sha256_hex(payload.voter_id)[:16],
        action="vote",
        detail=payload.commitment,
        status="valid",
    )

    return {
        "election_id": election_id,
        "ballot_commitment": payload.commitment,
        "signature_valid": True,
        "receipt": {
            "ballot_commitment": payload.commitment,
            "vote_signature": payload.signature,
            "timestamp": payload.timestamp,
        },
    }


# --------------------------------------------------------------------------
# Verification — public, and deliberately silent about who voted
# --------------------------------------------------------------------------


@app.get("/api/elections/{election_id}/verify/{commitment}")
def verify_vote(election_id: str, commitment: str) -> dict[str, object]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT b.*, e.ballot_public_key AS voter_pubkey
            FROM ballots b JOIN enrolments e ON e.election_id = b.election_id AND e.account_id = b.voter_id
            WHERE b.election_id = ? AND b.commitment = ?
            """,
            (election_id, commitment),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Ballot not found")

    record = record_from_row(row)
    signature_valid = verify_signature(
        record["voter_pubkey"], signing_payload(record).encode("utf-8"), record["signature"]
    )
    chain = audit.verify()

    return {
        "valid": bool(signature_valid and chain["valid"] and audit.contains(election_id, commitment)),
        "election_id": election_id,
        "commitment": commitment,
        "recorded_at": record["created_at"],
        "checks": {
            "signature_valid": signature_valid,
            "ballot_id_consistent": compute_ballot_id(
                election_id, record["voter_pubkey"], record["vote_nonce"]
            ) == record["ballot_id"],
            "in_audit_chain": audit.contains(election_id, commitment),
            "audit_chain_valid": chain["valid"],
        },
    }


# --------------------------------------------------------------------------
# Closing and tallying
# --------------------------------------------------------------------------


@app.post("/api/elections/{election_id}/close")
def close_election(election_id: str, payload: PassphraseRequest) -> dict[str, str]:
    with get_connection() as conn:
        unseal_election(conn, election_id, payload.master_passphrase)
        if conn.execute("SELECT active FROM elections WHERE id = ?", (election_id,)).fetchone()["active"] != 1:
            return {"status": "closed", "election_id": election_id}
        conn.execute("UPDATE elections SET active = 0 WHERE id = ?", (election_id,))
        conn.commit()

    audit.append(timestamp=now_iso(), election_id=election_id, actor="admin", action="close", detail="-", status="ok")
    return {"status": "closed", "election_id": election_id}


@app.post("/api/elections/{election_id}/tally")
def tally_election(election_id: str, payload: PassphraseRequest) -> dict[str, object]:
    with get_connection() as conn:
        _, private_key = unseal_election(conn, election_id, payload.master_passphrase)
        ballots = conn.execute(
            """
            SELECT b.*, e.ballot_public_key AS voter_pubkey
            FROM ballots b JOIN enrolments e ON e.election_id = b.election_id AND e.account_id = b.voter_id
            WHERE b.election_id = ?
            """,
            (election_id,),
        ).fetchall()

    choice_breakdown: dict[str, int] = {}
    commitments: list[str] = []
    rejected = 0

    with get_connection() as conn:
        allowed = {
            r["name"]
            for r in conn.execute(
                "SELECT name FROM candidates WHERE election_id = ?", (election_id,)
            )
        }

    for ballot in ballots:
        record = record_from_row(ballot)
        # Re-verify at decryption time. The signature was checked at submit, so
        # this only matters if the stored row was altered after the fact.
        if not verify_signature(record["voter_pubkey"], signing_payload(record).encode("utf-8"), record["signature"]):
            rejected += 1
            continue
        try:
            plaintext = open_with_private_key(
                {"ephemeral_pub": record["ephemeral_pub"], "nonce": record["nonce"], "ciphertext": record["ciphertext"]},
                private_key,
            )
            choice = json.loads(plaintext.decode("utf-8"))["choice"]
        except (InvalidTag, ValueError, KeyError):
            rejected += 1
            continue
        # A choice that is not on the frozen list means the ballot was built by
        # something other than the app, since the UI can only offer the listed
        # names. Counting it would let a crafted request invent a phantom
        # candidate, so it is rejected instead.
        if choice not in allowed:
            rejected += 1
            continue
        choice_breakdown[choice] = choice_breakdown.get(choice, 0) + 1
        commitments.append(record["commitment"])

    total_votes = sum(choice_breakdown.values())
    root = merkle.build_root(commitments)

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO results (election_id, total_votes, choice_breakdown, merkle_root, published_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (election_id, total_votes, json.dumps(choice_breakdown, sort_keys=True), root, now_iso()),
        )
        conn.commit()

    audit.append(
        timestamp=now_iso(),
        election_id=election_id,
        actor="admin",
        action="tally",
        detail=root,
        status="ok" if not rejected else f"{rejected} rejected",
    )

    return {
        "election_id": election_id,
        "status": "tallied",
        "total_votes": total_votes,
        "rejected_ballots": rejected,
        "choice_breakdown": choice_breakdown,
        "merkle_root": root,
    }


@app.get("/api/elections/{election_id}/results")
def published_results(election_id: str) -> dict[str, object]:
    with get_connection() as conn:
        election = conn.execute(
            "SELECT id, min_age, max_age, criteria_hash FROM elections WHERE id = ?",
            (election_id,),
        ).fetchone()
        if not election:
            raise HTTPException(status_code=404, detail="Election not found")
        row = conn.execute("SELECT * FROM results WHERE election_id = ?", (election_id,)).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Results have not been published yet")
    return {
        "election_id": row["election_id"],
        "total_votes": row["total_votes"],
        "choice_breakdown": json.loads(row["choice_breakdown"]),
        "merkle_root": row["merkle_root"],
        "published_at": row["published_at"],
        # The rule, and a hash of it. The hash proves the rule was not altered
        # after the fact; publishing the rule alongside it is what lets a reader
        # recompute the hash at all, which the old roster hash never allowed.
        "criteria": {"max_age": election["max_age"], "min_age": election["min_age"]},
        "criteria_hash": election["criteria_hash"],
    }


# --------------------------------------------------------------------------
# Audit
# --------------------------------------------------------------------------


@app.get("/api/elections/{election_id}/results/{commitment}/proof")
def results_inclusion_proof(election_id: str, commitment: str) -> dict[str, object]:
    """Prove a ballot was included in the published tally.

    Returns the sibling hashes from that commitment's leaf to the Merkle root.
    The caller recomputes the path locally, so this proves membership without
    having to trust that the server is reporting it honestly. A commitment that
    was not tallied gets no proof.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT total_votes, merkle_root, published_at FROM results WHERE election_id = ?",
            (election_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Results have not been published yet")
        leaves = [
            r["commitment"]
            for r in conn.execute(
                "SELECT commitment FROM ballots WHERE election_id = ?", (election_id,)
            )
        ]

    siblings = merkle.inclusion_proof(leaves, commitment)
    if siblings is None:
        return {"election_id": election_id, "commitment": commitment, "included": False}

    return {
        "election_id": election_id,
        "commitment": commitment,
        "included": True,
        "merkle_root": row["merkle_root"],
        "siblings": [{"hash": h, "side": side} for h, side in siblings],
        "total_votes": row["total_votes"],
        "published_at": row["published_at"],
    }


@app.get("/api/audit")
def read_audit(election_id: str | None = None, limit: int = 50) -> dict[str, object]:
    entries = [e for e in audit.tail(limit) if not election_id or e["election_id"] == election_id]
    return {"entries": entries}


@app.get("/api/audit/verify")
def verify_audit() -> dict[str, object]:
    return audit.verify()


# --------------------------------------------------------------------------
# The built frontend
# --------------------------------------------------------------------------

# `python run.py` → http://localhost:8080 is the only start command the README
# gives, so the server has to hand back the app rather than a JSON 404. The mount
# goes last so it cannot shadow an API route, and it is skipped when the bundle
# has not been built yet — in that case the Vite dev server on :5173 is the way in.
DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if (DIST_DIR / "index.html").is_file():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="frontend")
