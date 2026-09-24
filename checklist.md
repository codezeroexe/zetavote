# Project checklist

Last Updated: 2026-09-24 | Reviewer: <initials>

## Part 1 — Foundation

- [x] scaffold project folders and entrypoints
- [x] create `requirements.txt`
- [x] create `run.py`
- [x] create `backend/` package structure
- [x] create `frontend/` package structure
- [x] define SQLite schema for `elections`, `voters`, `ballots`
- [x] implement crypto helpers for keygen, sign, verify, AES-GCM encrypt/decrypt
- [x] create FastAPI app with health endpoint
- [x] verify app starts with `python run.py`
- [x] confirm app serves on `http://localhost:8080`

## Part 2 — Voter registration

- [x] build React registration form
- [x] generate browser Ed25519 keypair
- [x] encrypt private key with passphrase using scrypt
- [x] store keys in `data/keys/`
- [x] implement `POST /api/elections/{id}/register`
- [x] store public key + voter metadata in SQLite
- [x] generate receipt token JSON
- [x] allow voter to download receipt
- [x] test register flow with 3 sample voters

## Part 3 — Vote casting

- [x] build React vote selection form
- [x] unlock voter key with passphrase
- [x] sign vote payload with Ed25519 private key
- [x] encrypt vote with election key using AES-GCM
- [x] implement `POST /api/elections/{id}/vote`
- [x] validate election active status
- [x] validate voter eligibility
- [x] reject duplicate vote
- [x] verify signature and commitment hash
- [x] store encrypted ballot in SQLite
- [x] append hash-linked audit log entry
- [x] return vote receipt
- [x] test vote flow end-to-end

## Part 4 — Verification and tally

- [x] implement `GET /api/verify/:commitment`
- [x] validate signature and commitment integrity
- [x] reject replay / duplicate audit entries
- [x] implement admin close-election endpoint
- [x] require master passphrase for decryption
- [x] decrypt accepted ballots locally
- [x] tally votes by choice
- [x] publish final results
- [x] compute Merkle root
- [x] test full election lifecycle

## Part 5 — Hardening and packaging

- [x] add rate limiting and input validation
- [x] add error handling and safe defaults
- [x] add security headers / secure local defaults
- [x] verify hash-chain integrity on audit log
- [x] create PyInstaller packaging config
- [x] build `.app` / `.exe` output
- [x] document LAN access for local network use
- [x] document backup/export of `data/` directory
- [x] run full unit test suite
- [x] run full end-to-end test suite
- [x] finalize README and run instructions

## Completion gates

- [x] Part 1 complete
- [x] Part 2 complete
- [x] Part 3 complete
- [x] Part 4 complete
- [x] Part 5 complete
