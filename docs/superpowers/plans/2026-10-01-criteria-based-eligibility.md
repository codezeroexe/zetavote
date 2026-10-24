# Criteria-based eligibility — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the admin-uploaded roster with an age rule, and publish a
proof of that rule with the results.

**Architecture:** A new pure module `backend/eligibility.py` answers "does this
birthdate meet this rule" and "what is the hash of this rule". `accounts` gains a
readable `dob` and loses `dob_hash`; `roster` is deleted; `enrolments` loses
`roster_ordinal`. A new `election_blocks` table is an admin-curated deny-list.
Everything else — ballots, tally, verification, the audit chain, Merkle — is
untouched.

**Tech Stack:** Python 3.11, FastAPI, SQLite, pytest. React 18 + TypeScript for
the frontend.

**Spec:** `docs/superpowers/specs/2026-10-01-criteria-based-eligibility-design.md`

## Global Constraints

- No new dependencies. `requirements.txt` and `package.json` are unchanged.
- No data migration. Wipe `versions/v4/data` and recreate the admin.
- `name_hash` **keeps its salt**. `meta_value()` and `identity_salt()` stay.
- The date of birth is readable server-side and must never appear in any HTTP
  response body or in `data/votes_audit.log`. Task 7 is the test that enforces it.
- The eligibility refusal states the **rule**, never the applicant's age.
- The signature challenge is consumed and verified **before** eligibility is
  evaluated, as it is today.
- `ZV_TEST_SCRYPT_N` behaviour, `SCRYPT_N_*`, the ballot signing contract and
  `canonical_json` are unchanged.

## Review Focus

Failure modes the spec implies and the listed tests do not reach:

1. **A syntactically valid but non-existent date**, e.g. `1996-02-31`. Passes the
   `\d{4}-\d{2}-\d{2}` pattern, then explodes inside `date.fromisoformat`. Must be
   a 422 from the model, never a 500. *(Task 1)*
2. **Negative or zero age bounds.** `min_age: -1` admits everyone; `max_age: 0`
   admits nobody. Both must be rejected at election creation. *(Task 3)*
3. **A 29 February birthdate at a `max_age` boundary**, compared in a non-leap
   year. The standard age correction compares `(month, day)` tuples, which is the
   path that goes wrong here. *(Task 1)*
4. **The UTC date at the enrolment boundary.** Eligibility is judged against the
   server's UTC date, so a person enrolling at 10am in UTC+13 is judged on the
   previous day. The date used must be pinned in a test, not left to chance.
   *(Task 4)*
5. **Two accounts sharing a date of birth both enrolling.** Twins must both be
   allowed; this is the test that proves no uniqueness constraint crept back in.
   *(Task 4)*

---

### Task 1: `backend/eligibility.py`

**Files:**
- Create: `backend/eligibility.py`
- Test: `tests/test_eligibility.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```python
  def age_on(dob: str, today: date) -> int
  def meets_criteria(dob: str, min_age: int | None, max_age: int | None, today: date) -> bool
  def criteria_hash(min_age: int | None, max_age: int | None) -> str
  ```

- [ ] **Step 1: Write the failing tests** — `tests/test_eligibility.py`, covering
  the four spec table cases, both Review Focus items 1 and 3, and:
  - born 2008-12-31 with `min_age=18`: `age_on` is 17 on 2026-12-30 and 18 on
    2027-12-31 — the case that a year-based comparison gets wrong by admitting
    them in January.
  - born 2008-02-29, `max_age=18`, evaluated 2026-02-28 → 17; 2026-03-01 → 18.
  - `min_age` only, `max_age` only, both, neither (`None` on both → everyone).
  - `min_age > max_age` → `meets_criteria` returns False for every dob.
  - `criteria_hash(18, None) == criteria_hash(18, None)`, differs from
    `criteria_hash(None, 18)` and from `criteria_hash(19, None)`.
  - `age_on("1996-02-31", ...)` raises `ValueError` — the model layer is what
    turns that into a 422, not this function.

- [ ] **Step 2: Run it.** `python3 -m pytest tests/test_eligibility.py -q -p no:randomly`
  Expected: collection error, `ModuleNotFoundError: No module named 'backend.eligibility'`.

- [ ] **Step 3: Implement** the three functions in `backend/eligibility.py`.
  `age_on` is the standard correction, and must *not* be year-based:
  ```python
  age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
  ```
  `criteria_hash` is `sha256_hex(canonical_json({"max_age": max_age,
  "min_age": min_age}))`, reusing `backend.crypto`.

- [ ] **Step 4: Run it.** Expect PASS. Then the full suite: `python3 -m pytest
  tests/ -q -p no:randomly` — 212 existing plus these, all green.

---

### Task 2: Schema

**Files:**
- Modify: `backend/database.py`
- Modify: `backend/usernames.py`
- Modify: `tests/conftest.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `accounts.dob TEXT NOT NULL` (no `dob_hash`); `roster` gone;
  `elections.min_age`, `elections.max_age`, `elections.criteria_hash`;
  `enrolments` without `roster_ordinal`; new `election_blocks`;
  `usernames.fingerprint(name: str, salt: str) -> str` returning **one** value.
- `conftest.make_election(...)` gains `min_age=0` by default. `CAST` and
  `cast_roster()` are **deleted**.

- [ ] **Step 1: Edit `database.py`.** `accounts` drops `dob_hash` and gains `dob`;
  the index becomes `idx_accounts_identity ON accounts(name_hash, dob)`. Delete the
  `roster` table. `enrolments` drops `roster_ordinal`, its `UNIQUE`, and the
  `roster` foreign key. `_add_column(conn, "elections", "min_age", "INTEGER")`,
  `"max_age"`, and `"criteria_hash"` replace `roster_hash`. Add
  `election_blocks(election_id, username, reason, created_at)` with
  `PRIMARY KEY (election_id, username)`.

- [ ] **Step 2: Narrow `fingerprint`.** In `backend/usernames.py` it returns the
  name hash alone. Keep `identity_salt`/`meta_value` — they exist to stop a
  precomputed table of name hashes, and names are still hashed.

- [ ] **Step 3: Simplify `conftest.py`.** Delete `CAST`, `cast_roster()`, and the
  `roster` line in `make_election`; add `"min_age": 0` to the default body so the
  existing voting, replay, audit, window and tally tests need no edits.

- [ ] **Step 4: Run the suite.** Expect **failures** — `app.py` still writes
  `dob_hash` and `roster`. That is the next task's work; note the count.

---

### Task 3: Election creation

**Files:**
- Modify: `backend/app.py` (`RosterLine`, `ElectionCreateRequest`, `create_election`,
  the `roster_hash` helper)

**Interfaces:**
- Consumes: `criteria_hash(min_age, max_age)` from Task 1; the columns from Task 2.
- Produces: `POST /api/elections` accepts `min_age`/`max_age` (both optional,
  default `None`), rejects a negative bound and `min_age > max_age` with 400, stores
  `criteria_hash`, and returns `"criteria": {"max_age": …, "min_age": …}`. The
  `roster_hash` helper and `RosterLine` are gone.

- [ ] **Step 1: Write the failing tests** in `tests/test_criteria.py`: creation
  succeeds with no bounds; stores `criteria_hash` equal to `criteria_hash(None, None)`;
  rejects `min_age=-1` and `max_age=0` with 400; rejects `min_age=20,
  max_age=18` with 400; accepts `min_age=18, max_age=25`; the response echoes
  `criteria`. Review Focus item 2 lives here.

- [ ] **Step 2: Run it.** Expect FAIL — the endpoint still requires `roster`.

- [ ] **Step 3: Implement.** Drop `RosterLine`; add `min_age: int | None` and
  `max_age: int | None` to `ElectionCreateRequest` with
  `Field(None, ge=0, le=150)`. Validate `min_age <= max_age` when both are set.
  Insert `criteria_hash` instead of `roster_hash`, and delete the roster inserts.

- [ ] **Step 4: Run `tests/test_criteria.py` and the full suite.**

---

### Task 4: Enrolment by rule

**Files:**
- Modify: `backend/app.py` (`enrol_account`, `my_elections`)
- Modify: `tests/test_enrolment.py` (roster tests replaced)

**Interfaces:**
- Consumes: `meets_criteria` from Task 1.
- Produces: `enrol_account` refuses with 403 and
  `"This election is for people aged 18 and over"` when
  `meets_criteria(account["dob"], election["min_age"], election["max_age"],
  date.today())` is false, and with 403 and
  `"This account is blocked from this election"` when the username is in
  `election_blocks`. `my_elections` adds `eligible: bool` per row. The response
  drops `roster_ordinal`.

- [ ] **Step 1: Replace the roster tests in `tests/test_enrolment.py`** with:
  an under-age account is refused with 403 and the rule in the detail; an
  eligible account enrols with 201; exactly on the birthday is eligible, the day
  before is not (Review Focus item 4, using a fixed `today` where possible);
  **two accounts sharing a DOB both enrol** (item 5); enrolling twice is 409;
  the signature is still required and a wrong key is 401; the challenge is
  consumed even when the account turns out to be ineligible; the window rules
  are unchanged. Delete `expected_roster_hash` and every roster test.

- [ ] **Step 2: Run it.** Expect FAIL.

- [ ] **Step 3: Implement.** In `enrol_account`, after the signature check, read
  `election["min_age"]`, `election["max_age"]` and `account["dob"]`; evaluate
  `meets_criteria`. Compose the refusal from the rule — `"Ages 18 and over"`,
  `"Ages 18 to 25"`, `"No age limit"` — never from the account's own age. Delete
  the roster matching and the `roster.claimed_by` update. In `my_elections`, add
  `eligible` to each row.

- [ ] **Step 4: Run it.** Then fix `tests/test_verification_tally.py`, which
  imports `expected_roster_hash` — point it at the Task 6 replacement.

---

### Task 5: The block list

**Files:**
- Modify: `backend/app.py` (three new admin-gated endpoints)
- Test: `tests/test_blocks.py`

**Interfaces:**
- Produces: `GET /api/elections/{id}/blocks` → `{blocks: [{username, reason,
  created_at}]}`; `POST` with `{username, reason?}` → 201; `DELETE
  /api/elections/{id}/blocks/{username}` → 200. All three call `require_admin`.
  `enrol_account` consults the table and refuses 403.

- [ ] **Step 1: Write the failing tests** in `tests/test_blocks.py`: a blocked
  account cannot enrol (403, detail mentions blocked); unblocking restores it; a
  block may name an account that does not exist yet (201); an anonymous caller
  gets 401 and a voter gets 403 on all three endpoints; the list endpoint
  returns what was added.

- [ ] **Step 2: Run it.** Expect FAIL — 404, no such route.

- [ ] **Step 3: Implement** the three endpoints and the `enrol_account` check.

- [ ] **Step 4: Run it and the full suite.**

---

### Task 6: Publish the rule with the results

**Files:**
- Modify: `backend/app.py` (`published_results`)
- Modify: `tests/test_verification_tally.py`

**Interfaces:**
- Produces: `GET /api/elections/{id}/results` returns `criteria` and
  `criteria_hash`; `roster_hash` is gone.

- [ ] **Step 1: Write the failing test.** In `tests/test_verification_tally.py`,
  replace `expected_roster_hash` with a locally defined `expected_criteria_hash`
  that recomputes `sha256_hex(canonical_json({"max_age": …, "min_age": …}))` without
  calling the server's helper, and assert the published `criteria_hash` equals it.
  Also assert `criteria` is present and that two elections with the same rule
  publish the same hash while one with a different rule does not.

- [ ] **Step 2: Run it.** Expect FAIL.

- [ ] **Step 3: Implement.** Select `min_age`, `max_age`, `criteria_hash` from
  `elections` and publish all three.

- [ ] **Step 4: Run it and the full suite.**

---

### Task 7: The date of birth must not escape

**Files:**
- Test: `tests/test_dob_containment.py`

**Interfaces:**
- Consumes: Task 2's readable `dob` and Task 3/4's endpoints.

- [ ] **Step 1: Write the failing test.** One test, `test_the_date_of_birth_never_leaves_the_server`:
  create an account with a distinctive DOB, then assert the string appears in
  **none** of — `POST /api/accounts` response, `/api/auth/me`, `/api/me/elections`,
  `GET /api/elections/{id}`, `GET /api/elections/{id}/results`,
  `/api/audit?election_id=…`, `/api/audit/verify` — and not in the bytes of
  `data/votes_audit.log`. Use a DOB that cannot occur by accident.

- [ ] **Step 2: Run it.** If it passes immediately, that is a finding, not a
  formality: report it and check the assertion is actually reading the response
  bodies rather than a status code.

- [ ] **Step 3: Fix anything it catches.** Anything that does leak is a Task 1–6
  defect; fix it there and re-run.

- [ ] **Step 4: Run the full suite.**

---

### Task 8: Frontend

**Files:**
- Modify: `frontend/src/pages/Admin/CreateElection.tsx`
- Modify: `frontend/src/pages/Admin/AdminPage.tsx`
- Modify: `frontend/src/pages/Voter/VoterDashboard.tsx`
- Modify: `frontend/src/pages/Voter/ResultsPanel.tsx`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/types/api.ts`

**Interfaces:**
- Consumes: the wire shapes from Tasks 3–6.
- Produces: three new `api` methods (`listBlocks`, `addBlock`, `removeBlock`);
  `ElectionCreateRequest` loses `roster` and gains `min_age`/`max_age`;
  `PublishedResults` gains `criteria` and `criteria_hash`; `MyElection` gains
  `eligible`.

- [ ] **Step 1: Types and client.** Update the four interfaces and add the three
  block methods. Swap the four friendly error strings for
  `"This election is for people aged …"`, `"This account is blocked from this
  election"`, `"Already enrolled in this election"` and
  `"No age limit"`.

- [ ] **Step 2: `CreateElection`.** Replace the roster textarea with two number
  inputs (`min_age`, `max_age`), and read the rule back live beneath them —
  "Ages 18 and over" / "Ages 18 to 25" / "No age limit". The success panel's
  "Eligible list" row becomes the rule.

- [ ] **Step 3: `VoterDashboard`.** Read `election.eligible`. When false, render
  "Not eligible for this one" and **no Join button** — the old row state that
  offered a Join which could only fail is gone.

- [ ] **Step 4: `AdminPage`.** A blocked-accounts panel per election: an input, a
  reason field, an Add button, the list with reasons, and a Remove per row.

- [ ] **Step 5: `ResultsPanel`.** `criteria_hash` under the label "Eligibility
  Rule Hash", and the rule itself above it.

- [ ] **Step 6: Build.** `cd frontend && npm run build` — clean.

- [ ] **Step 7: `tests/test_api_contract.py`.** Run it. It checks both directions,
  so a forgotten route *or* a forgotten frontend call fails here. Fix whichever
  side is wrong.

---

### Task 9: Verification and wipe

**Files:**
- Modify: `scripts/browser_walkthrough.py`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update the walkthrough.** Replace the roster lines in elections
  `e1`/`e2` with `min_age`/`max_age`; assert `criteria` and `criteria_hash` are
  published; add a step that an under-age account is refused the rule and that a
  blocked account is refused. It stays hermetic.

- [ ] **Step 2: Run it.** `python3 scripts/browser_walkthrough.py` — every step
  green.

- [ ] **Step 3: Full gates.** `python3 -m pytest tests/ -q -p no:randomly`;
  `ZV_TEST_SCRYPT_N=262144 python3 -m pytest tests/test_crypto_parity.py -q`;
  `npm run build`.

- [ ] **Step 4: Wipe and re-verify from empty.** `rm -rf data`, then
  `python3 run.py --bootstrap-code` and confirm the schema is the new one.

- [ ] **Step 5: Ledger.** Record the stages, the rulings, and the four recorded
  weaknesses from the spec, in `PROGRESS.md`.