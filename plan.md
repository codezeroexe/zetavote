# plan

Secure Online Voting System — project plan. On-device deployment. SQLite + FastAPI + Ed25519/AES-GCM.

```
Last Updated: YYYY-MM-DD | Reviewer: <initials>
```

This plan is updated on each interaction — change the `Last Updated` date and reviewer initials to reflect the current state. Keep this section current; all other sections build on this foundation.

---

## Project Overview

**Goal:** Fully-featured secure online voting system with cryptographic voter authentication, encrypted ballot submission, hash-linked audit log for integrity, and verifiable result tally. On-device only — SQLite local file, localhost server, zero cloud dependencies after download.

**Non-goals:** Cloud hosting, global multi-user, internet-facing endpoints, automatic scaling, blockchain, SMS/MFA.

**Target deployment:** `python run.py` → `http://localhost:8080`. Optional PyInstaller pack into `.app`/`.exe`.

---

## Tech Stack

- **Backend:** Python + FastAPI + Uvicorn
- **Frontend:** React + Vite (runs locally, served by FastAPI)
- **Database:** SQLite (`data/elections.db`)
- **Crypto:** `cryptography` library — Ed25519 (signatures), AES-GCM (encryption)
- **Key derivation:** scrypt-based passphrase protection for private keys
- **No npm packages** for core crypto (batteries-included Python only)

---

## Core Data Flow

```
1. VOTER REGISTRATION
   ├── App at localhost:8080 → "Register Voter"
   ├── Browser generates Ed25519 keypair (Web Crypto API)
   ├── Private key encrypted with user passphrase (scrypt)
   ├── Key stored in `data/keys/voter_<id>.bin`
   ├── Public key + voter ID saved to SQLite
   ├── Receipt token downloaded (JSON: voter_id_hash, election_id, timestamp, commitment)
   └── Receipt proves registration without revealing private key

2. VOTE CASTING
   ├── Voter logs in (unlocks key with passphrase)
   ├── Selects candidate
   ├── Vote payload: { voter_id, choice, election_id, timestamp }
   ├── Sign with voter's Ed25519 private key
   ├── Encrypt with election public key (AES-GCM, unique nonce)
   ├── POST /api/vote → server validates:
       - Election active (timing check)
       - Voter eligible (not yet voted in this election)
       - Vote format valid (schema enforcement)
       - Signature verified against registered pubkey
       - Commitment hash matches stored format
   ├── Server stores encrypted vote in SQLite
   ├── Appends entry to hash-linked audit log (`data/votes_audit.log`)
   ├── Voter receipt: { ballot_commitment, vote_signature, timestamp }
   └── Receipt proves vote accepted without revealing choice

3. VERIFICATION
   ├── GET /api/verify/:commitment → checks:
       - Signature valid (Ed25519)
       - Commitment matches stored ballot
       - No double-submission (audit log)
       - Election timing valid
   ├── Returns: { valid: true/false, election_id, timestamp }
   └── No choice revealed — only integrity verification

4. ELECTION CLOSE + TALLY
   ├── Admin clicks "Close Election" (validates voting window ended)
   ├── Admin enters master passphrase (unlocks decryption key)
   ├── Each vote decrypted locally (AES-GCM)
   ├── Tally aggregates by choice
   ├── Merkle root computed for published results
   ├── Results: { choice_breakdown, total_votes, merkle_root }
   ├── Anyone can verify: tally matches accepted-ballot count + audit log integrity

5. AUDIT VERIFICATION (post-election)
   ├── Anyone can check: hash chain from `data/votes_audit.log` is intact
   ├── Each entry: SHA256(previous_hash + entry_data)
   ├── Genesis hash: SHA256("voting_audit_v1" + election_id) (first entry)
   ├── Published summaries: { total_ballots, choice_breakdown, merkle_root }
   └── No individual vote choices exposed
```

---

## API Endpoints (FastAPI)

| Method | Endpoint                                 | Description                                        |
| ------ | ---------------------------------------- | -------------------------------------------------- |
| `POST` | `/api/elections`                         | Create election (admin)                            |
| `GET`  | `/api/elections`                         | List elections (public)                            |
| `POST` | `/api/elections/{id}/register`           | Voter registers for election                       |
| `POST` | `/api/elections/{id}/vote`               | Submit encrypted vote (voter, unlocked)            |
| `GET`  | `/api/elections/{id}/verify/:commitment` | Verify vote integrity (public)                     |
| `POST` | `/api/elections/{id}/close`              | Close election (admin)                             |
| `POST` | `/api/elections/{id}/tally`              | Decrypt + tally results (admin, master passphrase) |
| `GET`  | `/api/elections/{id}/results`            | Publish final results (public)                     |
| `GET`  | `/api/audit/log`                         | Full audit log with hash chain (public)            |
| `GET`  | `/health`                                | Health check (public)                              |

**Validation on `/api/vote`:** Election active, voter not yet voted, schema check, Ed25519 signature verification, commitment hash check, replay protection (timestamp within ±5min or nonce used-before check).

---

## Crypto Primitives

### Ed25519 Key Management

- **Key generation:** `nacl.signing.KEYPAIR` (browser) or `cryptography.ed25519.generate_private_key()` (server)
- **Public key:** Stored in SQLite, linked to voter_id + election_id
- **Private key:** Encrypted with scrypt via `cryptography.hazmat.primitives.kdf.scrypt`; kept in memory until server shutdown
- **Key unlock:** User enters passphrase once per session

### AES-GCM Encryption

- **Key derivation:** Election-level key = scrypt(master_passphrase + election_salt)
- **Per-vote nonce:** 12-byte random (never reused, unique per vote)
- **Authenticated encryption:** AES-GCM provides confidentiality + integrity
- **Ciphertext format:** `{ nonce: base64, tag: base64, ciphertext: base64 }`
- **Decryption failure:** Returns integrity error (not choice leak)

### Hash-Linked Audit Log

- **File:** `data/votes_audit.log` (append-only text)
- **Format per entry:** `TIMESTAMP | ELECTION_ID | VOTER_HASH | BALLOT_COMMITMENT | SIGNATURE_VALID`
- **Hash chain:** `entry_hash = SHA256(previous_hash + entry_data)`
- **Genesis hash:** `SHA256("voting_audit_v1" + election_id)` (first entry)
- **Integrity verification:** Recompute entire chain from genesis to tip — any modification breaks chain
- **Public check:** Anyone can download log + verify chain independently

### Commitment Scheme

- **Commitment:** `SHA256(choice + vote_nonce)` — hides choice, binding property
- **Verification:** Check commitment matches stored ballot without revealing choice
- **Merkle tree:** Tallied choices → Merkle root published for public result verification

### Receipt Token

```json
{
  "voter_id_hash": "SHA256(pubkey)[:8]",
  "election_id": "election_123",
  "timestamp": "2024-01-15T10:30:00Z",
  "ballot_commitment": "SHA256(choice + nonce)",
  "vote_signature": "Ed25519_sig(ballot_commitment, voter_privkey)"
}
```

- Voter saves receipt locally
- Can prove: "My vote's commitment is in the audit log"
- Cannot prove: "Who I voted for" (commitment hides choice)

---

## Implementation Phases

### Phase 1: Foundation (2 days)

- [ ] Project scaffold: `run.py`, `requirements.txt`, `backend/`, `frontend/`
- [ ] SQLite schema: `elections`, `voters`, `ballots` tables
- [ ] Core crypto: `crypto.py` — keygen, sign, verify, AES-GCM encrypt/decrypt
- [ ] Basic FastAPI server: `main.py` with health endpoint
- [ ] Run: `python run.py` → localhost:8080

### Phase 2: Voter Flow (2 days)

- [ ] React UI: voter registration form
- [ ] Browser Ed25519 keypair generation (Web Crypto API)
- [ ] scrypt encrypted key storage in `data/keys/`
- [ ] API: `POST /api/elections/{id}/register`
- [ ] Receipt token generation + JSON download
- [ ] Test: register 3 voters, verify each receipt validates

### Phase 3: Vote Submission (2 days)

- [ ] React UI: vote form (candidate selection)
- [ ] Sign vote with private key (passphrase-unlocked)
- [ ] AES-GCM encrypt vote with election key
- [ ] API: `POST /api/elections/{id}/vote` with full validation
- [ ] Audit log append (hash chain entry)
- [ ] Test: cast vote, verify receipt, check audit log entry

### Phase 4: Verification & Tally (2 days)

- [ ] Verification page UI (commitment lookup)
- [ ] API: `GET /api/verify/:commitment`
- [ ] Admin: close election endpoint
- [ ] Decryption flow (master passphrase prompt)
- [ ] Tally aggregation code
- [ ] Results publication with Merkle root
- [ ] Test: full end-to-end flow

### Phase 5: Hardening & Packaging (2 days)

- [ ] Rate limiting, input validation, error handling
- [ ] Security headers (Helmet.js frontend, FastAPI security)
- [ ] PyInstaller build config → `.app`/`.exe`
- [ ] LAN networking guide (other devices on WiFi connect to host IP)
- [ ] Export/import data guide (backup `data/` directory)
- [ ] Final test suite run + documentation

---

## Test Strategy

### Unit Tests (`tests/unit/`)

| Test File          | Target                                     |
| ------------------ | ------------------------------------------ |
| `test_keygen.py`   | Ed25519 key generation + verification      |
| `test_sign_verify` | Sign message, verify signature roundtrip   |
| `test_aes_gcm`     | Encrypt → decrypt with integrity check     |
| `test_commitment`  | Commitment hides choice + binding property |
| `test_hash_chain`  | Audit log: modify entry → chain breaks     |
| `test_db_schema`   | SQLite tables created correctly            |

Run: `pytest tests/unit/ -v`

### End-to-End Tests (`tests/e2e/`)

Full voter flow test (10 steps):

1. `python run.py` → app at localhost:8080
2. Admin creates election with voting window
3. 3 voters register → each downloads receipt token
4. Each voter casts vote → receives receipt
5. 4th vote from same voter → rejected (duplicate prevention)
6. Each voter verifies receipt → all `valid: true`
7. Admin closes election (validates window ended)
8. Admin enters master passphrase → decryption + tally
9. Results published with Merkle root
10. Audit log hash chain verified

Run: `pytest tests/e2e/ -v --timeout=60`

---

## Run the system

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the app
python run.py

# 3. Open http://localhost:8080 in your browser
#    (or http://192.168.1.x:8080 on the same LAN)
```
