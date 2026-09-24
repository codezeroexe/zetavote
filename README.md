# ZetaVote

**Secure Online Voting System built for local, on-device elections.**

ZetaVote is a privacy-focused voting system designed to provide cryptographic voter authentication, encrypted ballot submission, tamper-evident auditing, receipt-based verification, and verifiable election results.

The system runs entirely on-device using a local SQLite database and a localhost FastAPI server. After setup, it requires no cloud services or external infrastructure.

> **Status:** In development  
> **Deployment:** Local / On-device  
> **License:** MIT

---

## Project Overview

ZetaVote is designed around five core goals:

- **Voter authentication** using Ed25519 digital signatures
- **Ballot confidentiality** using AES-GCM encryption
- **Vote integrity** through cryptographic commitments and signatures
- **Tamper-evident auditing** through a hash-linked audit log
- **Verifiable results** using accepted-ballot counts and a published Merkle root

### Design Principles

- Local-first architecture
- No cloud dependency
- No internet requirement after setup
- Cryptographic verification instead of trusting the application alone
- No individual vote choices exposed during receipt verification
- Independent audit-log verification

### Non-Goals

ZetaVote is not designed for:

- Cloud hosting
- Internet-facing public endpoints
- Global multi-user deployment
- Automatic scaling
- Blockchain-based voting
- SMS authentication or MFA

### Target Deployment

```text
python run.py
        ↓
http://localhost:8080
```

The application may optionally be packaged as a standalone `.app` or `.exe` using PyInstaller.

---

## Frontend handoff plan

The frontend is intentionally kept separate from the secure backend logic. The React app should act as a local client for the existing FastAPI endpoints and should not reimplement cryptographic validation on the browser.

### Frontend goals

- Admin panel: create election, close election, tally results
- Voter panel: register voter, submit vote, view receipt
- Verification panel: confirm ballot integrity and read final results
- Local-only workflow: backend on `http://localhost:8080`, frontend dev server on `http://localhost:5173`

### Local run flow

```bash
# backend
cd /Users/hari/projects/01-code-projects/crypto\ project
python run.py

# frontend
cd /Users/hari/projects/01-code-projects/crypto\ project/frontend
npm install
npm run dev -- --host 0.0.0.0
```

### Backend-to-frontend connection

Use a Vite proxy so the browser uses relative paths instead of hard-coded backend URLs:

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },
}
```

Then call the backend with fetches like:

```ts
const response = await fetch("/api/elections", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...payload }),
});
```

This avoids browser CORS errors while keeping the frontend decoupled from the backend port.

### Integration checklist

- [ ] configure Vite proxy to `localhost:8080`
- [ ] map each screen to a backend route
- [ ] handle loading, success, and error states
- [ ] keep UI state local; backend remains source of truth
- [ ] show API responses clearly in forms and receipts
- [ ] validate required fields before submit

---

## Tech Stack

| Layer               | Technology               |
| ------------------- | ------------------------ |
| Backend             | Python, FastAPI, Uvicorn |
| Frontend            | React, Vite              |
| Database            | SQLite                   |
| Digital Signatures  | Ed25519                  |
| Encryption          | AES-GCM                  |
| Key Derivation      | scrypt                   |
| Audit Integrity     | SHA-256 hash chain       |
| Result Verification | Merkle tree              |
| Packaging           | PyInstaller              |

### Project Architecture

```text
┌─────────────────────────────┐
│        React + Vite         │
│       Local Frontend        │
└──────────────┬──────────────┘
               │
               │ HTTP
               ▼
┌─────────────────────────────┐
│       FastAPI + Uvicorn     │
│        Local Backend        │
└───────┬───────────┬─────────┘
        │           │
        ▼           ▼
┌─────────────┐  ┌──────────────┐
│   SQLite    │  │ Crypto Layer │
│ elections   │  │ Ed25519      │
│ voters      │  │ AES-GCM      │
│ ballots     │  │ scrypt       │
└─────────────┘  └──────────────┘
        │
        ▼
┌─────────────────────────────┐
│   Hash-Linked Audit Log     │
│      votes_audit.log        │
└─────────────────────────────┘
```

---

# Features

## Voter Registration

- Browser-generated Ed25519 keypair
- Private-key protection using a user passphrase
- scrypt-based key derivation
- Public key associated with the voter and election
- Private key stored locally in encrypted form
- Registration receipt generated as JSON
- Receipt contains a voter identifier hash and registration commitment
- Private key is never included in the receipt

---

## Secure Vote Submission

Each vote goes through a cryptographic validation pipeline:

```text
Select Candidate
      ↓
Create Ballot Payload
      ↓
Generate Commitment
      ↓
Sign with Ed25519
      ↓
Encrypt with AES-GCM
      ↓
Submit to FastAPI
      ↓
Validate
      ↓
Store Encrypted Ballot
      ↓
Append Audit Entry
      ↓
Generate Vote Receipt
```

The server validates:

- Election status and voting window
- Voter eligibility
- Duplicate voting
- Request schema
- Ed25519 signature
- Ballot commitment
- Replay protection

---

## Vote Verification

Voters can verify their receipt using their ballot commitment.

Verification checks:

- Ed25519 signature validity
- Ballot commitment integrity
- Duplicate submission status
- Election timing
- Presence of the ballot in the audit system

Verification does **not** reveal the voter's selected choice.

Example response:

```json
{
  "valid": true,
  "election_id": "election_123",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Election Management

Administrators can:

- Create elections
- Configure voting windows
- Close elections
- Unlock the election decryption key
- Decrypt accepted ballots locally
- Tally votes
- Publish final results

The election must be closed before tallying.

---

## Auditing

ZetaVote maintains an append-only audit log:

```text
data/votes_audit.log
```

Each entry is linked to the previous entry using SHA-256:

```text
entry_hash =
    SHA256(previous_hash + entry_data)
```

Any modification to an existing entry breaks the chain from that point onward.

The audit chain can be independently recomputed and verified.

---

## Result Verification

After tallying:

- Choice totals are calculated
- Total accepted ballots are recorded
- A Merkle root is generated
- Results are published for verification

The published result contains:

```json
{
  "choice_breakdown": {},
  "total_votes": 0,
  "merkle_root": "..."
}
```

---

# Implementation Plan

The project is divided into five implementation phases.

## Phase 1 — Foundation

**Estimated duration:** 2 days

- [ ] Project scaffold
- [ ] `run.py`
- [ ] `requirements.txt`
- [ ] Backend structure
- [ ] Frontend structure
- [ ] SQLite schema
- [ ] Core cryptographic functions
- [ ] FastAPI server
- [ ] Health endpoint
- [ ] Local application startup

---

## Phase 2 — Voter Flow

**Estimated duration:** 2 days

- [ ] React registration interface
- [ ] Browser Ed25519 keypair generation
- [ ] Encrypted private-key storage
- [ ] Voter registration API
- [ ] Receipt-token generation
- [ ] JSON receipt download
- [ ] Registration validation tests

---

## Phase 3 — Vote Submission

**Estimated duration:** 2 days

- [ ] Candidate selection interface
- [ ] Passphrase-based key unlocking
- [ ] Vote signing
- [ ] AES-GCM encryption
- [ ] Vote submission API
- [ ] Input validation
- [ ] Duplicate-vote prevention
- [ ] Replay protection
- [ ] Audit-log append
- [ ] Vote receipt generation

---

## Phase 4 — Verification & Tally

**Estimated duration:** 2 days

- [ ] Receipt verification interface
- [ ] Commitment verification API
- [ ] Election closing
- [ ] Master passphrase flow
- [ ] Local ballot decryption
- [ ] Vote tallying
- [ ] Merkle-root generation
- [ ] Public result publication
- [ ] End-to-end testing

---

## Phase 5 — Hardening & Packaging

**Estimated duration:** 2 days

- [ ] Rate limiting
- [ ] Input validation hardening
- [ ] Error handling
- [ ] Security headers
- [ ] PyInstaller packaging
- [ ] `.app` build
- [ ] `.exe` build
- [ ] LAN networking documentation
- [ ] Data export/import documentation
- [ ] Final test suite

---

# API Reference

Base URL:

```text
http://localhost:8080
```

## Elections

| Method | Endpoint                       | Description                |
| ------ | ------------------------------ | -------------------------- |
| `POST` | `/api/elections`               | Create an election         |
| `GET`  | `/api/elections`               | List elections             |
| `POST` | `/api/elections/{id}/register` | Register a voter           |
| `POST` | `/api/elections/{id}/close`    | Close an election          |
| `POST` | `/api/elections/{id}/tally`    | Decrypt and tally results  |
| `GET`  | `/api/elections/{id}/results`  | Retrieve published results |

## Voting

| Method | Endpoint                                 | Description              |
| ------ | ---------------------------------------- | ------------------------ |
| `POST` | `/api/elections/{id}/vote`               | Submit an encrypted vote |
| `GET`  | `/api/elections/{id}/verify/:commitment` | Verify ballot integrity  |

## Auditing & Health

| Method | Endpoint         | Description            |
| ------ | ---------------- | ---------------------- |
| `GET`  | `/api/audit/log` | Retrieve the audit log |
| `GET`  | `/health`        | API health check       |

### Vote Validation

`POST /api/elections/{id}/vote` performs:

1. Election timing validation
2. Voter eligibility validation
3. Duplicate-vote detection
4. Schema validation
5. Ed25519 signature verification
6. Commitment validation
7. Replay protection

Replay protection uses a timestamp window of approximately ±5 minutes or a used-before nonce check.

---

# Cryptography

ZetaVote uses multiple cryptographic mechanisms, each serving a different purpose.

## Ed25519

Ed25519 provides voter authentication and digital signatures.

```text
Voter
  │
  ├── Private Key → Sign
  │
  └── Public Key  → Verify
```

The public key is associated with the voter and election in SQLite.

The private key is encrypted using scrypt-derived protection and remains available only after the voter unlocks it with their passphrase.

---

## AES-GCM

AES-GCM protects ballot confidentiality.

Each vote uses:

- An election-level encryption key
- A unique 12-byte random nonce
- Authenticated encryption

Conceptually:

```text
Plaintext Vote
      │
      ▼
   AES-GCM
      │
      ▼
Encrypted Ballot
```

The ciphertext representation is:

```json
{
  "nonce": "base64",
  "tag": "base64",
  "ciphertext": "base64"
}
```

A decryption failure is treated as an integrity failure rather than exposing ballot information.

---

## scrypt

scrypt is used for passphrase-based key protection.

The election-level key is derived from:

```text
master_passphrase + election_salt
```

Private voter keys are similarly protected using scrypt-derived encryption.

---

## Ballot Commitment

A ballot commitment is calculated as:

```text
SHA256(choice + vote_nonce)
```

The commitment provides a way to reference and verify a ballot without directly exposing the selected choice.

---

## Hash-Linked Audit Log

The audit log uses SHA-256 to create a chain of entries.

```text
Genesis
   ↓
Entry 1
   ↓
Entry 2
   ↓
Entry 3
   ↓
...
   ↓
Tip
```

The genesis hash is:

```text
SHA256("voting_audit_v1" + election_id)
```

Each subsequent entry is:

```text
SHA256(previous_hash + entry_data)
```

Changing an earlier entry causes subsequent hashes to become invalid.

---

## Merkle Root

After tallying, a Merkle tree is generated from the result data.

The resulting Merkle root is published alongside the final election results, providing a compact integrity value for result verification.

---

# Receipt Tokens

A voter receives a local JSON receipt after registration and after successfully submitting a vote.

Example structure:

```json
{
  "voter_id_hash": "SHA256(pubkey)[:8]",
  "election_id": "election_123",
  "timestamp": "2024-01-15T10:30:00Z",
  "ballot_commitment": "SHA256(choice + nonce)",
  "vote_signature": "Ed25519_sig(ballot_commitment, voter_privkey)"
}
```

A receipt allows the voter to establish that their ballot commitment exists in the voting system.

It does not expose their selected choice.

---

# Local Development

## Requirements

The current project plan specifies:

- Python
- Node.js/npm for the React/Vite frontend
- SQLite

## Installation

Clone the repository and install the Python dependencies:

```bash
pip install -r requirements.txt
```

---

## Start the Application

```bash
python run.py
```

The application will be available at:

```text
http://localhost:8080
```

For devices on the same LAN, the application may be accessed through the host machine's local IP:

```text
http://192.168.1.x:8080
```

---

## Data Storage

Local election data is stored in:

```text
data/
├── elections.db
├── keys/
└── votes_audit.log
```

The SQLite database contains the application's election, voter, and ballot data.

The audit log is maintained separately as an append-only text file.

---

# Testing

## Unit Tests

Unit tests are located in:

```text
tests/unit/
```

| Test               | Purpose                                 |
| ------------------ | --------------------------------------- |
| `test_keygen.py`   | Ed25519 key generation and verification |
| `test_sign_verify` | Signature round-trip                    |
| `test_aes_gcm`     | AES-GCM encryption/decryption           |
| `test_commitment`  | Commitment properties                   |
| `test_hash_chain`  | Audit-chain integrity                   |
| `test_db_schema`   | SQLite schema validation                |

Run:

```bash
pytest tests/unit/ -v
```

---

## End-to-End Testing

The complete voting flow tests:

1. Application startup
2. Election creation
3. Voter registration
4. Receipt generation
5. Vote submission
6. Duplicate-vote rejection
7. Receipt verification
8. Election closing
9. Ballot decryption and tallying
10. Merkle-root generation
11. Audit-chain verification

Run:

```bash
pytest tests/e2e/ -v --timeout=60
```

---

# Roadmap

Current project progress:

| Phase   | Status | Focus                 |
| ------- | :----: | --------------------- |
| Phase 1 |   ☐    | Foundation            |
| Phase 2 |   ☐    | Voter Flow            |
| Phase 3 |   ☐    | Vote Submission       |
| Phase 4 |   ☐    | Verification & Tally  |
| Phase 5 |   ☐    | Hardening & Packaging |

### Progress Checklist

- [ ] **Phase 1:** Foundation
- [ ] **Phase 2:** Voter Flow
- [ ] **Phase 3:** Vote Submission
- [ ] **Phase 4:** Verification & Tally
- [ ] **Phase 5:** Hardening & Packaging

The roadmap should be updated as implementation progresses.

---

# Project Status

ZetaVote is currently in the **planning / implementation stage**.

The authoritative implementation plan is maintained in:

```text
plan.md
```

The plan contains the current architecture, implementation phases, API design, cryptographic design, and testing strategy.

---

## License

MIT
