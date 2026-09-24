import base64
import json
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import AUDIT_LOG_PATH, KEYS_DIR
from .crypto import (
    compute_commitment,
    decrypt_bytes,
    derive_key_from_passphrase,
    encrypt_bytes,
    generate_ed25519_keypair,
    sha256_hex,
    sign_message,
    verify_signature,
)
from .database import get_connection, init_db

init_db()

app = FastAPI(title="ZetaVote", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
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


class ElectionCreateRequest(BaseModel):
    id: str
    name: str
    description: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    master_passphrase: str | None = None


class VoterRegistrationRequest(BaseModel):
    voter_id: str = Field(..., min_length=1)
    passphrase: str = Field(..., min_length=1)


class VoteCastRequest(BaseModel):
    voter_id: str = Field(..., min_length=1)
    choice: str = Field(..., min_length=1)
    vote_nonce: str = Field(..., min_length=1)
    passphrase: str = Field(..., min_length=1)


class CloseElectionRequest(BaseModel):
    master_passphrase: str = Field(..., min_length=1)


class TallyRequest(BaseModel):
    master_passphrase: str = Field(..., min_length=1)


@app.on_event("startup")
def startup_event() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/elections")
def create_election(payload: ElectionCreateRequest) -> dict[str, str | None]:
    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM elections WHERE id = ?", (payload.id,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Election already exists")

        conn.execute(
            """
            INSERT INTO elections (id, name, description, active, starts_at, ends_at, master_passphrase)
            VALUES (?, ?, ?, 1, ?, ?, ?)
            """,
            (payload.id, payload.name, payload.description, payload.starts_at, payload.ends_at, payload.master_passphrase),
        )
        conn.commit()

    return {
        "id": payload.id,
        "name": payload.name,
        "description": payload.description,
        "starts_at": payload.starts_at,
        "ends_at": payload.ends_at,
    }


@app.post("/api/elections/{election_id}/register")
def register_voter(election_id: str, payload: VoterRegistrationRequest) -> dict[str, object]:
    with get_connection() as conn:
        election = conn.execute("SELECT id FROM elections WHERE id = ?", (election_id,)).fetchone()
        if not election:
            raise HTTPException(status_code=404, detail="Election not found")

        existing_voter = conn.execute(
            "SELECT id FROM voters WHERE election_id = ? AND id = ?",
            (election_id, payload.voter_id),
        ).fetchone()
        if existing_voter:
            raise HTTPException(status_code=400, detail="Voter already registered")

    private_key_b64, public_key_b64 = generate_ed25519_keypair()
    private_key_bytes = base64.b64decode(private_key_b64)
    derived_key, salt = derive_key_from_passphrase(payload.passphrase)
    encrypted = encrypt_bytes(private_key_bytes, derived_key)

    key_record = {
        "salt": base64.b64encode(salt).decode("ascii"),
        "nonce": encrypted["nonce"],
        "ciphertext": encrypted["ciphertext"],
    }
    key_path = KEYS_DIR / f"voter_{payload.voter_id}.json"
    key_path.write_text(json.dumps(key_record), encoding="utf-8")

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO voters (id, election_id, public_key, key_path, status)
            VALUES (?, ?, ?, ?, 'registered')
            """,
            (payload.voter_id, election_id, public_key_b64, str(key_path)),
        )
        conn.commit()

    receipt = {
        "voter_id_hash": sha256_hex(payload.voter_id)[:8],
        "election_id": election_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "registration_commitment": sha256_hex(f"{election_id}:{payload.voter_id}:{public_key_b64}"),
    }

    return {
        "election_id": election_id,
        "voter_id": payload.voter_id,
        "public_key": public_key_b64,
        "key_path": str(key_path),
        "receipt": receipt,
    }


@app.post("/api/elections/{election_id}/vote")
def cast_vote(election_id: str, payload: VoteCastRequest) -> dict[str, object]:
    with get_connection() as conn:
        election = conn.execute("SELECT id, active FROM elections WHERE id = ?", (election_id,)).fetchone()
        if not election:
            raise HTTPException(status_code=404, detail="Election not found")
        if election["active"] != 1:
            raise HTTPException(status_code=400, detail="Election is not active")

        voter = conn.execute(
            "SELECT public_key, key_path FROM voters WHERE election_id = ? AND id = ?",
            (election_id, payload.voter_id),
        ).fetchone()
        if not voter:
            raise HTTPException(status_code=404, detail="Voter not registered for this election")

        prior_vote = conn.execute(
            "SELECT id FROM ballots WHERE election_id = ? AND voter_id = ?",
            (election_id, payload.voter_id),
        ).fetchone()
        if prior_vote:
            raise HTTPException(status_code=400, detail="Duplicate vote rejected")

    key_data = json.loads(open(voter["key_path"], "r", encoding="utf-8").read())
    key_material = derive_key_from_passphrase(payload.passphrase, base64.b64decode(key_data["salt"]))[0]
    private_key_blob = decrypt_bytes({"nonce": key_data["nonce"], "ciphertext": key_data["ciphertext"]}, key_material)
    private_key_b64 = base64.b64encode(private_key_blob).decode("ascii")

    ballot_payload = {
        "voter_id": payload.voter_id,
        "choice": payload.choice,
        "election_id": election_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "vote_nonce": payload.vote_nonce,
    }
    ballot_json = json.dumps(ballot_payload, sort_keys=True)
    ballot_commitment = compute_commitment(payload.choice, payload.vote_nonce)
    ballot_signature = sign_message(private_key_b64, ballot_json.encode("utf-8"))
    valid_sig = verify_signature(voter["public_key"], ballot_json.encode("utf-8"), ballot_signature)
    if not valid_sig:
        raise HTTPException(status_code=400, detail="Invalid ballot signature")

    encrypted_ballot = encrypt_bytes(ballot_json.encode("utf-8"), base64.b64decode("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="))
    ballot_id = sha256_hex(f"{election_id}:{payload.voter_id}:{payload.choice}:{payload.vote_nonce}")

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO ballots (id, election_id, voter_id, ballot_data, commitment, signature)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                ballot_id,
                election_id,
                payload.voter_id,
                json.dumps(encrypted_ballot, sort_keys=True),
                ballot_commitment,
                ballot_signature,
            ),
        )
        conn.commit()

    audit_entry = f"{datetime.now(timezone.utc).isoformat()} | {election_id} | {sha256_hex(payload.voter_id)} | {ballot_commitment} | valid\n"
    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as log_file:
        log_file.write(audit_entry)

    receipt = {
        "ballot_commitment": ballot_commitment,
        "vote_signature": ballot_signature,
        "timestamp": ballot_payload["timestamp"],
    }

    return {
        "election_id": election_id,
        "voter_id": payload.voter_id,
        "ballot_commitment": ballot_commitment,
        "signature_valid": valid_sig,
        "receipt": receipt,
    }


@app.get("/api/health")
def api_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/elections/{election_id}/verify/{commitment}")
def verify_vote(election_id: str, commitment: str) -> dict[str, object]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, voter_id, ballot_data, signature FROM ballots WHERE election_id = ? AND commitment = ?",
            (election_id, commitment),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Ballot not found")

    return {
        "valid": True,
        "election_id": election_id,
        "voter_id": row["voter_id"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "commitment": commitment,
    }


@app.post("/api/elections/{election_id}/close")
def close_election(election_id: str, payload: CloseElectionRequest) -> dict[str, str]:
    with get_connection() as conn:
        election = conn.execute("SELECT id, active, master_passphrase FROM elections WHERE id = ?", (election_id,)).fetchone()
        if not election:
            raise HTTPException(status_code=404, detail="Election not found")

        if payload.master_passphrase != election["master_passphrase"]:
            raise HTTPException(status_code=401, detail="Invalid master passphrase")

        if election["active"] != 1:
            return {"status": "closed", "election_id": election_id}

        conn.execute(
            "UPDATE elections SET active = 0 WHERE id = ?",
            (election_id,),
        )
        conn.commit()

    return {"status": "closed", "election_id": election_id}


@app.post("/api/elections/{election_id}/tally")
def tally_election(election_id: str, payload: TallyRequest) -> dict[str, object]:
    with get_connection() as conn:
        election = conn.execute("SELECT id, active, master_passphrase FROM elections WHERE id = ?", (election_id,)).fetchone()
        if not election:
            raise HTTPException(status_code=404, detail="Election not found")

        if payload.master_passphrase != election["master_passphrase"]:
            raise HTTPException(status_code=401, detail="Invalid master passphrase")

        ballots = conn.execute(
            "SELECT voter_id, ballot_data, commitment FROM ballots WHERE election_id = ?",
            (election_id,),
        ).fetchall()

    choice_breakdown: dict[str, int] = {}
    for ballot in ballots:
        ballot_data = json.loads(ballot["ballot_data"])
        decrypted = decrypt_bytes(ballot_data, base64.b64decode("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="))
        decoded = json.loads(decrypted.decode("utf-8"))
        choice = decoded["choice"]
        choice_breakdown[choice] = choice_breakdown.get(choice, 0) + 1

    total_votes = sum(choice_breakdown.values())
    return {
        "election_id": election_id,
        "status": "tallied",
        "total_votes": total_votes,
        "choice_breakdown": choice_breakdown,
        "merkle_root": sha256_hex(f"{election_id}:{json.dumps(choice_breakdown, sort_keys=True)}"),
    }
