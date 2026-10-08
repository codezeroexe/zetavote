# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

This folder (`versions/v4`) is the active ZetaVote codebase. The sibling folders `versions/v1-workspace`, `v2-backend`, and `v3-ui` are older snapshots. Do not edit them unless asked. `PROGRESS.md`, `fixes.md`, and `CHANGES_REQUIRED.md` in this folder track the in-progress staged work; check them before changing security or schema behaviour.

## Commands

Backend (Python 3.11, run from `versions/v4`):

```bash
pip install -r requirements.txt
python run.py                      # FastAPI on 127.0.0.1:8080 (ZV_HOST / ZV_PORT override)
python run.py --reset-admin        # admin_cli.py commands; flags start with "--"
pytest -q                          # full suite, ~25s, currently 269 passing
pytest tests/test_vote.py -q       # one file
pytest tests/test_vote.py::test_name -q   # one test
```

Frontend (`frontend/`):

```bash
npm install
npm run dev        # Vite on 5173, proxies /api and /health to 127.0.0.1:8080
npm run build      # tsc -b && vite build; treat type errors as failures
npm run lint       # oxlint
```

There is no frontend test runner. Verification of UI flows lives in `scripts/` (`browser_walkthrough.py`, `review_flow.py`, `verify_surfaces.py`) and expects a running backend.

Test isolation: `tests/conftest.py` redirects `DATA_DIR`, `DB_PATH`, `AUDIT_LOG_PATH`, and `KEYS_DIR` into a temp sandbox before `backend.app` is imported. Do not remove that redirect. Without it the suite wipes the real `data/elections.db`. `ZV_TEST_SCRYPT_N` lowers the scrypt cost for speed; parity tests must use the real cost.

## Architecture

**Two independent implementations of the same crypto.** `backend/crypto.py` and `frontend/src/services/crypto.ts` must produce byte-identical output for scrypt, HKDF, AES-GCM, Ed25519 signatures, and canonical JSON. `tests/test_crypto_parity.py` pins vectors emitted by the TypeScript side. If a signature or key stops matching, check both files and the parity vectors before touching endpoints. Scrypt cost constants (`SCRYPT_N_VOTER = 2**16`, `SCRYPT_N_ELECTION = 2**18`) must match on both sides.

**Key hierarchy.** Accounts are global and last for life. Each account holds an Ed25519 key sealed under the voter's password. The server never sees that password, so the sealed key is opened in the browser at each sign-in. The account key only signs login challenges. Each election mints a fresh ballot keypair per enrolment, and ballots use X25519 + AES-GCM to the election key. Ballot keys are unlinkable across elections by design. Do not put the account key on a ballot or in any audit entry.

**Election key lifecycle.** The election key is sealed under the admin's master passphrase, which is never stored. Close and tally require that passphrase. Tally decrypts ballots in memory, counts them, and publishes results plus a Merkle root.

**Backend layout (`backend/`).**
- `app.py` (~1500 lines) holds every FastAPI route. Session handling uses an HTTP-only cookie `zv_session` and `require_session` / `require_admin` dependencies. Security headers and CORS are set here.
- `database.py` runs `init_db()` on import. Schema lives in `CREATE TABLE IF NOT EXISTS` blocks. Those never upgrade an existing table, so a schema change needs a migration path or a wipe of `data/`.
- `auth.py` handles sessions and challenges. `eligibility.py` checks the age rule. The DOB is hashed for the check and never stored. `usernames.py` derives usernames from legal name plus four digits.
- `audit.py` writes `data/votes_audit.log`, a single global SHA-256 hash chain. Every ballot, close, and tally appends an entry. `/api/audit/verify` recomputes the chain. Editing any line breaks every later hash.
- `merkle.py` builds the results tree. `/api/elections/{id}/results/{commitment}/proof` returns the inclusion proof.

**Privacy invariant.** Choices never appear in receipts, verify responses, audit entries, or any surface before close. Keep it that way when adding fields. Verification proves a ballot exists and counted, not what it said.

**Frontend layout (`frontend/src/`).** Pages are grouped by role under `pages/` (`Admin`, `Voter`, `Verify`, `Login`). `auth/SessionContext.tsx` holds session state. `services/api.ts` is the only place that calls `/api`. `services/crypto.ts` is the browser half of the crypto contract. `services/online.ts` and `components/Status/BackendStatus.tsx` surface backend reachability.

**Data files.** `data/` holds `elections.db`, `keys/`, and `votes_audit.log`. It is local state and must not be committed. `data/elections.db.pre-v4` is a leftover backup.

## Conventions specific to this repo

- The product is a local, single-machine demo. Do not add CORS origins, public bind addresses, rate limiting, or cloud dependencies without an explicit ask. The default bind to loopback is deliberate.
- Plain-language copy matters in the UI. Read `PRODUCT.md` and `DESIGN.md` at the repo root before changing user-facing text or styling.
