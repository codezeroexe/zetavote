# zetavote

Secure Online Voting System — on-device only. No cloud, no internet required after setup.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the app
python run.py

# 3. Open http://localhost:8080 in your browser
#    (or http://192.168.1.x:8080 on the same LAN)
```

## Roadmap (5 phases, ~10 days)

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1: Foundation** | ☐ | Project scaffold, SQLite schema, core crypto (`crypto.py`), basic FastAPI server (`main.py`) |
| **Phase 2: Voter Flow** | ☐ | React UI registration, browser Ed25519 keypair (Web Crypto), scrypt-encrypted key storage, `/api/register`, receipt tokens |
| **Phase 3: Vote Submission** | ☐ | React vote form, sign + AES-GCM encrypt vote, `/api/vote` with full validation, audit log hash-chain append |
| **Phase 4: Verification & Tally** | ☐ | Verification page UI, `/api/verify/:commitment`, admin close election, master passphrase decryption, tally aggregation, Merkle root results |
| **Phase 5: Hardening & Packaging** | ☐ | Rate limiting, security headers, PyInstaller build → `.app`/`.exe`, LAN networking guide, export/import data guide |

**Run:** `python run.py` → `http://localhost:8080`

## Progress

- [ ] Phase 1: Foundation
- [ ] Phase 2: Voter Flow
- [ ] Phase 3: Vote Submission
- [ ] Phase 4: Verification & Tally
- [ ] Phase 5: Hardening & Packaging

## Living Plan

The project plan is in `plan.md`. Update `Last Updated: YYYY-MM-DD | Reviewer: <initials>` on each interaction to keep it current.

## License

MIT (or choose whatever fits).