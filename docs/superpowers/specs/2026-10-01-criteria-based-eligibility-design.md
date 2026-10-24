# Criteria-based eligibility — design

**Date:** 2026-10-01
**Status:** approved in chat, pending review of this document
**Working copy:** `versions/v4`

---

## The problem

An election currently requires the admin to upload a roster: one line per
eligible person, `Name, YYYY-MM-DD`. For any real body of voters that is a
spreadsheet to obtain, a format to get right, and a list of names and birthdates
to type by hand. It is the single most inconvenient thing about running an
election, and it is not load-bearing for the security model.

Replace it with a **rule**: an election states who may vote ("aged 18 and over"),
and anyone whose account satisfies the rule may join.

## What replaces it

| | Now | After |
|---|---|---|
| Eligibility | a name+DOB line an admin uploaded | `min_age` / `max_age` on the election |
| Who may join | the account whose fingerprint matches an **unclaimed** roster line | any account meeting the rule |
| One ballot per | roster line (`UNIQUE(election_id, roster_ordinal)`) | account (`PRIMARY KEY(election_id, account_id)`) |
| Published proof | `roster_hash` over the slugged name list | `criteria_hash` over the rule |

## Goals

- An admin creates an eligible election by typing one number.
- The published results carry a proof that the rule was not changed after the
  fact, and anyone can recompute it.
- Voting, tallying, verification and the audit chain are untouched.

## Non-goals

Deliberately out of scope, and each is a real limitation rather than an oversight:

- **No geography.** Considered and declined; it needs a trusted source for the
  value, and a self-declared free-text zone is neither trusted nor bounded.
- **No fixed cutoff date.** Age is judged at the moment someone joins, not
  against a date the election names. Over a three-week window, someone eligible
  on day 1 and someone eligible on day 20 are treated identically.
- **No exception or allow list.** That would put manual entry back.
- **No identity verification.** Nothing here can confirm the date of birth is
  real, or that the person is who they say they are.
- **No data migration.** The project already wipes rather than migrates; this
  follows that decision.

---

## Data model

### `accounts`

```sql
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,          -- username
    name_hash TEXT NOT NULL,      -- one-way; names stay hashed
    dob TEXT NOT NULL,            -- READABLE, new
    public_key TEXT NOT NULL,
    sealed_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)
CREATE INDEX idx_accounts_identity ON accounts(name_hash, dob)
```

`dob_hash` is **removed**. Hashing a field the server must do arithmetic on buys
nothing: once the date is readable, a hash of it protects nothing that reading it
does not already expose.

`name_hash` stays hashed, and **keeps its salt**. The database-wide
`identity_salt` in the `meta` table exists to stop a precomputed table of hashes
for every plausible name, and names are low-entropy enough for that to matter.
`fingerprint()` in `backend/usernames.py` therefore narrows to the name alone and
returns one value; the salt, `meta_value()` and `identity_salt()` all stay.

### `elections`

Two nullable integers, plus a column for the proof:

```sql
min_age      INTEGER   -- NULL = no lower bound
max_age      INTEGER   -- NULL = no upper bound
criteria_hash TEXT     -- SHA256(canonical_json({"max_age":…,"min_age":…}))
```

`roster_hash` is dropped. `min_age` and `max_age` are a *band*, not just a floor:
a student union needs 18–25, and a second nullable integer plus one validation
line covers it. `min_age > max_age` is a 400.

### `roster` — dropped

### `enrolments`

Drops `roster_ordinal`, its `UNIQUE(election_id, roster_ordinal)` index, and the
foreign key into `roster`. The primary key `(election_id, account_id)` is
unchanged and still enforces one ballot per account per election.

### `election_blocks` — new

```sql
CREATE TABLE IF NOT EXISTS election_blocks (
    election_id TEXT NOT NULL,
    username TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (election_id, username),
    FOREIGN KEY (election_id) REFERENCES elections(id)
)
```

An admin-curated list of accounts barred from one election. It may name an
account that does not exist yet, which is how a known duplicate can be blocked
before its third attempt.

---

## The rule

New module `backend/eligibility.py`, three pure functions:

```python
def age_on(dob: str, today: date) -> int
def meets_criteria(dob: str, min_age: int | None, max_age: int | None,
                   today: date) -> bool
def criteria_hash(min_age: int | None, max_age: int | None) -> str
```

`age_on` is exact rather than year-based, because a year-based comparison admits
underage voters at the boundary: born 2008-12-31 satisfies
`birth_year + 18 <= 2027` in January 2027, while still being 17 until December.
The correction is the standard one:

```python
age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
```

Pure and date-injected so every boundary case is a unit test rather than a
coincidence of when the suite runs.

The results publish **both** the rule and its hash. The hash proves the rule was
not altered; the rule itself is public anyway, and publishing the hash alone
would prove nothing to a reader who could not see what had been hashed — the same
reason the old `roster_hash` could not be independently recomputed.

`criteria_hash` is `SHA256(canonical_json({"max_age": …, "min_age": …}))` over
the sorted-key canonical form already used for the ballot commitments, so it is
byte-compatible with the browser's `canonicalJson`.

---

## Endpoints

### Changed

| Endpoint | Change |
|---|---|
| `POST /api/elections` | `roster: [...]` → `min_age` / `max_age`; response gains `criteria` |
| `POST /api/elections/{id}/enrol` | no roster match; refusal reasons change |
| `GET /api/me/elections` | each election gains `eligible: bool` |
| `GET /api/elections/{id}/results` | `roster_hash` → `criteria`, plus `criteria_hash` |

### New (admin session required)

| Endpoint | |
|---|---|
| `GET /api/elections/{id}/blocks` | `{blocks: [{username, reason, created_at}]}` |
| `POST /api/elections/{id}/blocks` | `{username, reason?}` → 201 |
| `DELETE /api/elections/{id}/blocks/{username}` | 200 |

### Removed

`GET /api/elections/open` went in Stage 6 and stays gone. Nothing else in the
route table is removed.

### Enrolment refusals

| Condition | Status | Detail |
|---|---|---|
| no account session | 401 | `Not signed in` |
| admin session | 403 | `Voter access required` |
| window closed | 400 | existing `registration_shut` reason |
| username blocked for this election | 403 | `This account is blocked from this election` |
| account does not meet the rule | 403 | **the rule**, not the person: `This election is for people aged 18 and over` |
| already enrolled | 409 | `Already enrolled in this election` |
| bad or reused signature | 401 | unchanged, and still checked before eligibility |

The eligibility refusal states the rule rather than the applicant's age, so the
response cannot be used to confirm a birthdate the server holds.

---

## Frontend

| File | Change |
|---|---|
| `Admin/CreateElection.tsx` | roster textarea → two number inputs, with the rule read back live ("Ages 18 and over" / "Ages 18 to 25" / "No age limit") |
| `Admin/AdminPage.tsx` | blocked-accounts panel per election: add by username with a reason, list, remove |
| `Voter/VoterDashboard.tsx` | reads `eligible`; offers **Join** only when true, otherwise says "Not eligible for this one" and offers nothing |
| `Voter/ResultsPanel.tsx` | `criteria_hash` under the label "Eligibility Rule Hash" |
| `services/api.ts` | three block calls; four friendly error strings swapped for the new reasons |

`Enrol.tsx`, `CastVote.tsx` and `RegisterAccount.tsx` need no changes: enrolment
already sends only a ballot key plus a signature, and neither depends on there
being a roster.

---

## Tests

The single largest effect is on the fixtures. With no roster to upload, the
five-person `CAST` and its roster builder are deleted from `tests/conftest.py`,
and `make_election` defaults to `min_age=0` so every account is eligible. **The
~160 existing voting, replay, audit, window and tally tests need no edits.**

`tests/test_enrolment.py` — roster tests replaced by:

- **Boundary exactness.** Born the day before the cutoff is one day short;
  born on it is eligible; born the day after is not. Run against a fixed date, so
  this is not a coincidence of when the suite runs.
- 29 February, and a `max_age` boundary.
- Min only, max only, both, neither.
- A malformed date is a 422, not a crash.
- **Block list.** A blocked account cannot enrol; unblocking restores it; a
  non-admin gets 403 and an anonymous caller 401; a block may name an account
  that does not exist yet.
- **`criteria_hash`** recomputed independently in the test — applying the
  documented rule itself, not calling the server's helper — is what the results
  publish, it changes when the rule changes, and it is identical for identical
  rules across elections.

**The most important new test** inverts one that exists today.
`test_name_and_dob_are_never_stored` proved the date of birth was not stored; it
is now stored, so the guarantee it defended has to be rebuilt around what still
must not happen:

> the date of birth never appears in any API response body, and never appears in
> the audit log file.

That test walks account creation, `/api/auth/me`, `/api/me/elections`, election
detail, results and the audit endpoints, plus a read of `votes_audit.log`. Names
stay hashed, and this is what keeps the readable date contained.

`tests/test_verification_tally.py` swaps its `expected_roster_hash` import for
`expected_criteria_hash`. `tests/test_api_contract.py` needs no edits and will
catch a forgotten route or a forgotten frontend call.

---

## Migration

Wipe `versions/v4/data` and recreate the admin, per the existing no-migration
decision. The schema changes are edits to `CREATE TABLE` and one `_add_column`
call; nothing reads an older database.

---

## What this weakens

Recorded rather than buried, because four of these are real costs:

1. **Eligibility becomes self-asserted.** The admin used to attest a list; now
   the person attests themselves. This is the price of not maintaining a
   spreadsheet, and no amount of hashing recovers the old property.
2. **The database holds everyone's date of birth.** Contained by never returning
   or logging it, and defended by a test rather than left to chance. Anyone with
   the database file now learns everyone's birthday — which for a school or
   workplace roll is a small but real disclosure.
3. **Nothing stops one person from voting twice.** A duplicate account can
   register again and vote again. The block list acts only on a duplicate an
   admin has already identified, and a determined person makes a third account.
   This is weaker than the roster line was.
4. **Turnout changes meaning.** `ballots / enrolments` becomes "of those who
   joined" rather than "of those eligible", because the eligible population is
   unknowable without a list. The published number stays truthful; it no longer
   means what a reader will assume.

`max_age` is included on the strength of one plausible case. Drop it if it is not
one.