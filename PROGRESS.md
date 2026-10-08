# ZetaVote v5 — stages, plan, and progress

Working copy: `/Users/hari/projects/01-code-projects/crypto project/versions/v4`
Base: v3 UI + v2 improved backend hybrid. HEAD `739b5ad` on `main` — **all work uncommitted.**

---

## Status

| Stage | Name | State |
|---|---|---|
| 1 | Accounts schema | ✅ Complete |
| 2 | Username helpers (tests first) | ✅ Complete |
| 3 | Global registration + username login | ✅ Complete |
| 4 | Roster + enrolment | ✅ Complete |
| 5 | Rewire voting + tally | ✅ Complete |
| 6 | Frontend | ✅ Complete |
| 7 | Test speed | ✅ Complete (pulled forward) |
| 8 | Wipe data + full verification | 🟡 Backend verified; browser click-through outstanding |
| 9 | Criteria-based eligibility (age rule, not a roster) | ✅ Complete |

**Current gate: 274 passed in 29.7s · parity 7 · build clean · walkthrough 52/52 · `data/` empty.**

Stage 7 was deliberately pulled ahead of its planned position because it gates
every other stage — at the original `2^18` scrypt cost a single full-suite run
took ~3.5 minutes, which made every stage gate expensive to verify.

---

## Decisions (locked)

| | |
|---|---|
| Account | One, global, for life. Not per-election |
| Username | `slug(legal name)` + 4 user-editable digits, **case-sensitive** |
| Collision | Suggest alternatives, never refuse |
| Login | Username + password. No election ID |
| Registration | On the login page |
| Key storage | **Sealed only** — password every sign-in, every device |
| DOB | Eligibility check only; hashed, never stored, never a credential |
| Ballot keys | Fresh per election, unlinkable across elections |
| Roster | Admin-supplied; `roster_hash` published with results |
| Duplicate name+DOB | Warning, not a block |
| Enumeration | Not a concern; no rate limiting on username probing |
| Nav tabs | **Signed-in only** |
| Navbar chrome | Always: brand, theme toggle, `BackendStatus` |
| Role toggle | Moves into the login page header |
| Test data | Wipe (no migration) |
| Sign out | Navbar (resolved — navbar now always renders) |
| Brand text | Navbar shows mark-only on login page; header owns the name |

### Security invariants

- Voter passwords never reach the server; the sealed key is opened locally.
- Account key signs login challenges only. It never appears on a ballot, so the
  audit log cannot link activity across elections.
- One roster line = one enrolment = one ballot.
- Master passphrase required for close/tally, never stored.
- Voter-facing counts hidden while open; revealed after close.
- Audit, results, verify, public browse all unauthenticated.

---

## Target schema

**`accounts`** — identity, one row per person, for life
```
id           TEXT PRIMARY KEY   -- username; BINARY collation = case-sensitive free
name_hash                    -- one-way salted fingerprint
dob_hash                     -- one-way salted fingerprint
public_key                   -- signs login challenges only
sealed_key                   -- account key sealed under a passphrase the server never sees
created_at
```

**`enrolments`** — who may vote where
```
election_id, account_id      -- PK together
ballot_public_key            -- minted fresh here, never reused from the account
sealed_ballot_key
roster_ordinal               -- UNIQUE per election: one claim per roster line
```

**`roster`** — eligible list, uploaded at election creation, frozen
```
election_id, ordinal         -- PK together
name_hash, dob_hash          -- hashed, never a readable name or date
claimed_by                   -- FK to accounts(id)
```

**`elections`** gains `roster_hash` — `SHA256(canonical_json(sorted roster))`,
published in the results payload so anyone holding the original list can prove
it was not edited.

**`ballots`** switches its FK from `voters(election_id, id)` to
`enrolments(election_id, account_id)` in Stage 5.

---

## Stage 1 — Accounts schema ✅

**Done.** New tables `accounts`, `enrolments`, `roster` in
`backend/database.py`; `elections.roster_hash` added via the existing
`_add_column` helper.

Verified by direct constraint probe:

| Constraint | Result |
|---|---|
| `asha0142` accepted alongside `Asha0142` | ✅ case-sensitive, free from SQLite `BINARY` |
| Exact duplicate `Asha0142` rejected | ✅ `UNIQUE constraint failed: accounts.id` |
| Second account on a claimed roster row | ✅ `UNIQUE ... enrolments.roster_ordinal` |
| Distinct roster row still claimable | ✅ |

### Deviation from the original plan

`voters` was **kept** as a deprecated shim rather than dropped. `ballots` has a
foreign key into it, so dropping the table would have broken every `cast_vote`
test and made this stage non-neutral. It is dropped in Stage 5, when `ballots`
actually switches over. Nothing new may reference it.

---

## Stage 2 — Username helpers ✅

**Done.** `backend/usernames.py` — `slugify()`, `is_valid_username()`,
`suggest()`. Zero coupling: no database, no crypto, `taken` is a parameter.
26 new tests in `tests/test_usernames.py`, written and run before the module
existed (RED was `ModuleNotFoundError`).

All four spec rows pass, plus non-decomposing letters, idempotence, and
`suggest()` determinism / wrap-around / exhaustion.

Mutation-checked, so the tests are known to bite: dropping the ASCII filter and
shortening the `suggest()` walk fails 3 of the 26.

### Rulings

| Question | Ruling | Cost if wrong |
|---|---|---|
| "preserve suffix case" — which suffix? | The four digits. `slugify()` only ever touches the name; the caller appends the user's digits verbatim, and nothing here may lowercase them | If it meant a generational suffix (`Jr`), one extra rule in `slugify()` |
| Non-Latin name | Slugifies to `""`. Real transliteration needs a table or a dependency, so the caller asks the person to choose their own stem | CJK and Cyrillic users must type a stem instead of seeing one derived |
| `suggest()` exhausted | Returns `None` after walking all 10 000 suffixes. Never a taken name | — |
| Length cap on a username | None. The slug comes from a real name; a cap would refuse long names for a column that is only compared, never executed | Very long ids stay possible; harmless |
| Does the validator police the digit count? | No. It enforces charset, a leading letter, and a four-digit tail. `asharao01420` therefore validates as stem `asharao0` + `1420` | A 5-digit username the UI never generates gets accepted — cosmetic |

---

## Stage 3 — Global registration + username login ✅

**Done.** 22 tests written first (RED: 22 failed), then the endpoints.

| Endpoint | |
|---|---|
| `POST /api/accounts` | 201, or 409 with a `suggestions` array — never a bare refusal |
| `GET /api/accounts/available?name&digits` | `{username, available, suggestions}`, unauthenticated |
| `GET /api/accounts/{username}/sealed-key` | replaces the per-election fetch, same rate limit |

`voter_login`, `issue_challenge` and `rotate_seal` now read `accounts`, keyed by
username. `VoterLoginRequest.voter_id` and `ChallengeRequest.voter_id` are gone —
no election id reaches the auth path at all.

`test_registration.py` rewritten (8 tests → 16, all against `/api/accounts`).
`test_auth.py`'s voter block rewritten: 4 → 6 tests. `conftest.py` gains
`register_account()`; `register()` stays for the shim.

Mutation-checked twice: case-folding the login lookup and un-slugifying the
fingerprint each fail exactly one test, the right one.

### Rulings

| Question | Ruling | Cost if wrong |
|---|---|---|
| Keep `/api/elections/{id}/register`? | Yes, as the deprecated `voters` shim, until Stage 5 rewires and drops the table. It is what ~50 other tests' `register()` helper calls, and deleting it now would make those tests write to the database directly | Two registration paths exist for two more stages |
| Rename `make_voter_keys`? | No. It mints an Ed25519 pair plus a sealed blob, which is the same operation for an account and for a shim voter row. Added `register_account()` alongside instead | The name reads as legacy vocabulary |
| Where does the identity salt live? | A `meta(key, value)` table. A module constant would not survive a restart, and a *fixed* salt would make every name+DOB pair precomputable — a date of birth is nearly free entropy to guess | One extra table |
| Slug the name before fingerprinting? | Yes. `José Álvarez` / `jose alvarez` / `JOSE  ALVAREZ` must be one person, or the duplicate warning and the Stage 4 roster match both miss | — |
| Case-sensitive, but only lowercase registers | Registration accepts only `slug + 4 digits`, so no mixed-case account can exist; login must not fold case either, or a wrong-case sign-in silently resolves to the account the user meant | A person who types `Asha0142` into the sign-in box is told the account is unknown rather than being corrected |
| Session `role` value | Still `"voter"`. Renaming it touches `my_elections` and the frontend's role switch for no behaviour change; Stage 6 is the place for that rename | Vocabulary lags the schema until Stage 6 |
| Does registration mint a session? | No. The client already holds the key, so it signs the challenge it was going to sign anyway | One extra round trip after registering |

### Carried forward to Stage 4

- The two registration-window tests dropped from `test_registration.py` are not
  lost — a window only exists at enrolment, so they belong there:
  `registering_before_the_window_opens_is_allowed` and
  `test_registering_is_refused_once_the_window_closes`.
- Enrolment **does** require a voter session, because the session is how the
  server knows which account is claiming a row. What it must not do is make the
  browser re-send the name and date of birth: the account's fingerprints are
  already stored, so the request carries only a key.
- **`roster_hash` cannot be computed over salted fingerprints.** The plan
  describes it as `SHA256(canonical_json(sorted roster))`, and the roster rows
  hold `name_hash`/`dob_hash`. A third party holding the original list cannot
  reproduce those without the database's identity salt, so a published
  `roster_hash` computed over them would be unverifiable by exactly the audience
  it exists for. Compute it over the plaintext list at upload time and discard
  the plaintext. `canonical_json` also takes a dict today, not a list.

---

## Stage 4 — Roster + enrolment ✅

**Done.** `tests/test_enrolment.py`, 20 tests written first (RED: 16 failed,
4 passed vacuously). `POST /api/elections/{id}/enrol` claims the matching roster
line and mints nothing server-side — the browser sends a ballot key it sealed
itself. `roster` is uploaded on `POST /api/elections` and `roster_hash` is stored
in the same insert.

The test file recomputes `roster_hash` independently — applying the documented
slug rule itself rather than calling the server's helper — so it checks the
published format, not just that the function is idempotent.

The two window tests carried forward from Stage 3 now live here, in enrolment
wording.

### Rulings

| Question | Ruling | Cost if wrong |
|---|---|---|
| `roster_hash` over salted fingerprints? | **No** — over the slugged list, sorted. A third party with the original list cannot reproduce fingerprints without this database's identity salt, and Stage 8 wipes the database. A hash nobody can recompute proves nothing. This is the concern Stage 3 flagged, resolved | If the intent was to bind the hash to the stored rows, it is no longer independently verifiable |
| Sign the enrol request with the account key? | Yes, and the plan did not ask for it. A session cookie alone would let an attacker enrol someone with a ballot public key **they** hold the private half of — i.e. cast that person's ballot. Reuses the `rotate_seal` pattern | One extra challenge round trip before enrolling |
| Claim before or after the enrolment insert? | After. `UNIQUE(election_id, roster_ordinal)` is the real limit on one ballot per line; `roster.claimed_by` is the readable marker. Claiming first would leave a claimed row with no enrolment if the insert failed | — |
| Is `roster` required at election creation? | Optional, default empty, and an empty roster enrols **nobody** (400). Making it required would force all ~50 existing tests to invent rosters for elections that use the shim path | An admin who forgets the roster gets a closed election and a clear message rather than an open one |
| Check the signature before eligibility? | Yes. A replayed request is then refused on its own terms instead of depending on what changed since, and the nonce is burned either way | — |
| Rename `create_election`'s local `identity_salt`? | Yes, to `legacy_identity_salt`. It would otherwise shadow the new `identity_salt()` import and silently salt every account with the election's salt | — |
| `canonical_json` typing | Widened from `dict[str, object]` to `object`; it already serialised lists correctly | — |

---

**Gate at this stage: 163 passed in 23.4s · parity 7 · build clean.**

`voters` is gone. `generate_voter_id`, `ID_WORDS`, `ID_DIGITS`,
`VoterRegistrationRequest`, `VoterRegisterRequest`, `POST /register` and
`GET /voter/{id}/sealed-key` are deleted. `ballots.voter_id` is the **account**
and its foreign key is `enrolments(election_id, account_id)`, so a ballot row
cannot exist without a claimed roster line behind it.

### The plan said four sites. There were seven

| Site | Was |
|---|---|
| `list_elections` | `COUNT(*) FROM voters` |
| `get_election` | `COUNT(*) FROM voters` |
| `my_elections` | `LEFT JOIN voters` |
| `cast_vote` | `SELECT public_key FROM voters` |
| `verify_vote` | `JOIN voters` |
| `tally_election` | `JOIN voters` |

`list_elections` and `get_election` were missed in the plan. Both publish the
registered count, so leaving them on a dropped table would have broken the public
browse endpoints outright rather than subtly.

### Rulings

| Question | Ruling | Cost if wrong |
|---|---|---|
| How do the other 150-odd tests keep passing? | `conftest.register()` now creates the account and enrols it, returning the **ballot** key. `build_ballot` translates the test's voter handle into an account id internally, so no test file changed its vote code. `make_election` seeds the default roster from an explicit `CAST` dict | A new voter handle needs a cast entry, and the failure is a KeyError naming it rather than a 403 three layers down |
| The cast roster as a default | Yes. Every existing test casts a vote, and enrolment now needs a roster, so the default has to contain the people the suite uses | An explicit `roster=[]` is required to make an election nobody is eligible for — two tests do this |
| Session changes mid-test | `register()`/`cast()` sign in as the account, because enrolment is authorised by the session. A test that then calls an admin-only endpoint calls the new `as_admin()` helper. One test needed it | Tests that mix an admin and a voter flow must restore the session explicitly |
| Keep the wire name `registered` for enrolment? | Yes. It means "on the roll for this election" in both the public count and the per-voter flag, and renaming it would churn the frontend for no behaviour change | The word no longer matches the table name |
| `test_verify_does_not_leak_voter_identity` | Rewritten to assert on `account_id("secret-voter")`, not on the test handle. Asserting only on the handle would have passed **even if the real account id leaked**, because the handle is no longer what appears on a ballot — a privacy test quietly reduced to a tautology | — |
| `test_registration_is_refused_once_the_window_closes` | Deleted from `test_windows.py`; the same rule is now `test_enrolment_is_refused_once_the_window_closes` | — |
| Wipe `versions/v4/data` now? | No need to ask — the directory was already empty (the test fixture wipes it), so Stage 8's wipe is a formality. The old `ballots` FK pointed at `voters`, which would have broken the dev database between now and Stage 8 | — |
| `elections.identity_salt` | Dropped, along with its `_add_column` call. It existed only for the shim's per-election fingerprint, and accounts use the database-wide salt | A stale column survives in an un-migrated database; Stage 8 wipes it |
| Dead import `SCRYPT_N_VOTER` in `auth.py` | Removed. Pre-existing, and the file was being edited anyway | — |

---

## Stage 6 — Frontend ✅

**Done.** Rewritten against the new API, not patched. Build clean.

| File | Change |
|---|---|
| `types/api.ts` | account + enrolment + roster types in; the six voter-registration types out |
| `services/crypto.ts` | two key lifetimes: `zetavote.account.<username>` and `zetavote.ballot.<election>.<username>`. Nine lookup helpers with two overloads became six |
| `services/api.ts` | `accountLogin`, `checkUsername`, `createAccount`, `enrol`, `getSealedKey(username)`. `listOpenElections` and `registerVoter` deleted |
| `LoginPage.tsx` | Sign in beside Create Account, role toggle into the page header |
| `Voter/Enrol.tsx` | **new** — replaces `RegisterVoter.tsx`, deleted |
| `VoterDashboard` | five row states, no signed-out path |
| `CastVote` / `ResultsPanel` | the ballot key, never the account key |
| `CreateElection` | eligible-list textarea, `name, YYYY-MM-DD` per line |
| `Navbar` / `App.tsx` | `canVerify` gone, tabs signed-in only, brand mark-only on the login page |

The `local`-state workaround the plan flagged is confirmed gone: the dashboard has
one data source, `/api/me/elections`, which requires a session. The signed-out
branch that needed `listOpenElections` was deleted rather than repaired.

### New: the drift check

`tests/test_api_contract.py`, 49 tests, both directions — every path `api.ts`
calls must exist on the backend, and every backend route must be called by
something. It exists because the wire types are hand-written, so a renamed field
or path segment compiles cleanly and 404s at runtime. It found a real orphan on
its first run: `GET /api/elections/open` had lost its only caller, so it is
deleted.

Paths only, not methods or payload fields. Extracting a method from
`request(path, { method })` is fragile, and a wrong method is caught by any test
that exercises the flow; a renamed path was caught by nothing.

### Verification

`scripts/browser_walkthrough.py` — not a test, run by hand. Real uvicorn, real
socket, real cookies, real scrypt cost, 12 steps and 33 assertions over the exact
sequence the browser performs. Hermetic: `config.py` resolves its paths at
import, so the script repoints `database` and `audit` at a temp directory before
`backend.app` runs `init_db()`. Without that it overwrote the real
`elections.db` and the second run failed on the first run's leftovers — which is
how the bug was found.

It covers: bootstrap → create election with a list → register → a taken username
suggests → sign in on a *different* device by opening the sealed key locally →
challenge replay refused → enrol with a fresh ballot key → a twin account warned
but blocked from a second ballot → vote → verify → dashboard → close → tally →
results with a recomputable `roster_hash` → offline reveal.

**Not done: a real click-through in a browser.** The walkthrough covers the HTTP
and crypto contract; it cannot tell whether a button is where a person expects
it. That is the one item left, and it belongs to Stage 8.

### Rulings

| Question | Ruling | Cost if wrong |
|---|---|---|
| Frontend slug rules? | Not reimplemented. The browser asks `/api/accounts/available?name&digits` and renders the server's answer, so there is one implementation of the slug rule instead of two that drift | A 250 ms debounce before the username appears |
| The 409 on a collision loses the suggestions? | Yes — `api.ts` keeps only `message`. The availability check runs 250 ms earlier, so hitting this is a genuine race, and changing the digits re-runs the check and shows alternatives | A person who races loses the inline suggestions, sees "already taken", and retries |
| Roster format | `Name, YYYY-MM-DD` per line, split on the **last** comma, so a name may contain commas | A name ending in a comma breaks the line |
| `RegisterVoter.tsx` | Deleted rather than repointed. Its entire reason for existing — allocating a per-election voter id — is gone | — |
| The `local` state | Confirmed unreachable under global accounts and deleted with the signed-out branch | — |
| `api.enrol` takes the username separately | Yes, so `EnrolRequest` stays the true wire shape and the caller passes no placeholder challenge/signature | One more argument |
| Sign-in with a cached key | **Removed.** See "Corrected after review" below | — |


## Stage 7 — Test speed ✅ (pulled forward)

**Done.** `3.5 min → 10.5s`.

| Cost | Per derivation | × 164 derives |
|---|---|---|
| `2^18` (was) | 2.50 s | 410 s |
| `2^12` (tests) | 0.04 s | 6 s |

One seam: `_resolve_n()` inside `crypto.py`, clamping `n` on every call.
Necessary because `n` is bound as a **default argument**, so patching module
constants would not have reached it.

Deliberately **not** read from the environment at import — a stray env var in
production would silently weaken every sealed key in the database. Only
`tests/conftest.py` sets it.

`tests/test_crypto_parity.py` clears the clamp via an autouse fixture, since
its vectors were emitted by the browser at real cost. Confirmed still passing
at `2^16` (7 passed, 0.63s).

`init_db()` runs on every `get_connection()` but is 0.28 ms — left alone.

---

## Stage 8 — Wipe data + full verification 🟡

`versions/v4/data` deleted, then verified from nothing. Everything the plan asks
for except a real browser click-through is done and green.

| Check | Result |
|---|---|
| `data/` wiped | ✅ gone, and the app recreates the schema on first run |
| Fresh `run.py --bootstrap-code` | ✅ prints a first-run code from an empty tree |
| Schema from empty | ✅ 10 tables, `voters` absent, `ballots` FK on `enrolments(election_id, account_id)` |
| Two elections end to end | ✅ same account, two enrolments, two unrelated ballot keys, two independent tallies, two different `roster_hash` values |
| Walkthrough | ✅ 41/41 over real HTTP |
| Full suite | ✅ 212 passed in 19.8s |
| Real-cost parity | ✅ 7 passed |
| Frontend build | ✅ clean |

The walkthrough is hermetic, so it never touched the wiped directory — it runs in
a temp dir and deletes it. The schema check above is a separate one-off against
the real `data/` after the CLI ran.

### Corrected after review

Stage 6 shipped a sign-in that skipped the passphrase when the browser already
held the account key — a one-click path. That contradicted a locked decision
("sealed only — password every sign-in, every device") and, worse, it was not
merely a UX shortcut: the private key was in `localStorage`, so anything able to
read page storage could sign a login challenge without ever knowing the
passphrase. The requirement was decorative.

Fixed, and the fix goes further than the reported symptom:

- **No private key is written to `localStorage` at all.** Only sealed blobs are,
  which are ciphertext the server already holds.
- The **account** key is unlocked by the passphrase at sign-in and held **in
  memory** for the tab. Gone on reload, gone on sign-out — `signOut()` now calls
  `forgetAccountKey()`, because a key that outlives a sign-out means the sign-out
  did not end anything.
- The **ballot** key is never cached either, not even in memory. `CastVote` asks
  for the ballot passphrase and unseals it locally. That key is the only thing
  that admits a ballot to `cast_vote`, which checks a signature and no session at
  all, so caching it would have been the same mistake one layer down.

Cost: voting now asks for the ballot passphrase as well as the one at sign-in, and
a reload between joining and voting needs the account passphrase again before
enrolling. Both are the honest price of the rule.

### The one thing left

**A real browser pass is not something I can do from here.** The walkthrough
covers the HTTP contract, the cookie handling and the byte-for-byte crypto; it
cannot tell you whether the Register button is where a person expects it, or
whether the navbar tabs read correctly signed out.

What a person should click, in this order:

1. `python run.py` and open the app. Navbar shows brand + theme toggle +
   `BackendStatus` and **no tabs**. The login header owns the word *ZetaVote* and
   the navbar shows the mark alone — check that does not read as broken.
2. Role toggle sits under the subtitle, not below the lockup. Sign in as admin.
3. Create an election with an eligible list (`Name, YYYY-MM-DD` per line). The
   success panel should report how many people are on it.
4. Sign out. Register an account: type a name, watch the username resolve to
   `slug + digits` about a quarter-second later, and change the digits to a taken
   one to see the alternatives.
5. Sign in as that account — **the passphrase is required every time**, on every
   device. The dashboard should show the election as *not on the eligible list*
   with a **Join** button. Join it, choosing a ballot passphrase.
6. Cast a vote. It asks for the ballot passphrase again, because that key was never
   saved to the device. Download the receipt. Verify the commitment on the Verify tab.
   Reload the page and check nothing is still unlocked: sign-in asks again, and
   joining/voting each ask their own passphrase.
7. Back as admin: close, tally, and confirm the results panel shows the eligible
   list hash.

Two of those are the ones I most suspect: the mark-only brand on the login page
(a deliberate choice from the plan, but it can read as a missing wordmark), and
the 250 ms debounce before the username appears.

## Pre-existing bug found and fixed

Found while running the Stage 1 gate. Not caused by Stage 1 or 7 — the full
suite had simply never been re-run after a registration-window guard landed
earlier in the session, so the regression was hiding behind targeted runs.

**Symptom:** 3 failures in `test_windows.py` / `test_vote.py`, all failing in
*setup*, never reaching the vote assertion they were written to test.

**Root cause:** the register guard rejected registration outside the voting
window, and `test_windows.py`'s `vote()` helper calls `register()` internally
for windows that are deliberately shut.

**Which side was wrong — both, differently:**
- *Before the window opens*: the guard was wrong. Preparing a ballot early is
  harmless; the ballot simply cannot be cast yet. Refusing it was user-hostile
  with no security benefit.
- *After close*: the guard was right. A voter registering post-close can never
  vote, yet still appears in the registered count, leaving published turnout
  irreconcilable against the voter list. Here the *tests* were wrong — they
  must register while open, then have the window close.

**Fix:**
- New `registration_shut()` in `app.py` — registration stays open until the
  window closes, not only while it is open.
- `close_window()` helper in `conftest.py` shifts `ends_at` into the past, so a
  test can register while open and then model the window closing. Creating an
  election already-closed cannot express this.
- Rewrote the 3 tests; added
  `test_registration_is_refused_once_the_window_closes` to cover the other half
  of the rule.
- Renamed `test_registering_before_the_window_opens_is_rejected` →
  `..._is_allowed` and flipped its assertion, since the old rule was the bug.

Net: **101 tests, up from 100.**

---

## Not doing

- Migrating `versions/v4/data` — wiping instead
- Rate-limiting username probing — enumeration is not a concern
- Blocking duplicate accounts — warning only
- Changing the ballot signing contract, audit format, or Merkle algorithm
- The `--reset-admin` CLI stays as-is

---

## Stage 9 — Criteria-based eligibility ✅

The roster an admin used to upload is gone. An election now states an age rule.

**Gate: 274 passed · parity 7 · build clean · walkthrough 52/52 · `data/` empty.**

Spec and plan: `docs/superpowers/specs/2026-10-01-criteria-based-eligibility-design.md`,
`docs/superpowers/plans/2026-10-01-criteria-based-eligibility.md`. Neither is
committed — this tree is uncommitted throughout, so they were left that way.

The single largest effect was deletions. `conftest`'s five-person `CAST` and its
roster builder are gone, and the ~160 existing voting, replay, audit, window and
tally tests needed **no edits**.

### What it cost, as agreed

1. **Eligibility is self-asserted.** The admin used to attest a list; the person
   attests themselves now.
2. **The database holds everyone's date of birth.** It never left the responses or
   the audit log — `tests/test_dob_containment.py` walks eleven endpoints and the
   log file, and is **mutation-checked**: pointing the audit `detail` at the DOB
   makes it fail.
3. **A duplicate account can vote twice.** This is real and is asserted as such in
   the walkthrough rather than papered over:
   *"and it is NOT refused — this is the cost of dropping the roster"*.
4. **Turnout means "of those who joined"**, since the eligible population is
   unknowable without a list.

### Rulings

| Question | Ruling | Cost if wrong |
|---|---|---|
| `min_age=0` vs no bound — same rule, different hash? | Different hashes. The hash covers the rule **as stated**, because that is the thing attested. `describe()` still renders `0 and over` as "no age limit" | Two equivalent elections publish different proofs |
| Leap-day birthdates | Rejected, not approximated. `date.fromisoformat("2008-02-29")` only parses in a leap year, so an account created on 29 Feb is unmatchable against a `max_age` boundary. Same reason any other impossible date is a 422 | A real 29 Feb person cannot be age-checked. The alternative — normalising to 1 Mar — is inventing a birthday |
| Signed with the account key? | Unchanged from Stage 4. The block list is the *only* new endpoint and it needs no signature: it is admin-gated and moderated after the fact | — |
| Does blocking retract a ballot? | **No.** Blocking governs joining, not counting — withdrawing a ballot after the fact is the manipulation this app exists to prevent. `test_a_block_does_not_retract_a_ballot_that_was_already_cast` pins it | An admin expecting a block to remove a counted vote is surprised |
| Where does the DOB rule live? | `backend/eligibility.py`, pure, with `today` injected. No clock seam in the request path — the day-before boundary is pinned there rather than by adding a seam to production code for a test | None |
| Is `max_age` kept? | Yes, per your approval. `tests/test_criteria.py` covers both bounds, the inclusive edges, and rejects negative and absurd ones | One nullable int |

### Pre-flight carried into this stage

The Stage 3 note asked whether `roster_hash` could be recomputed by a third party.
It could not — fingerprints are salted. That is why `criteria_hash` is now over
the *rule*, published **alongside** the rule: the hash proves the rule was not
altered, and publishing the rule is what lets anyone recompute the hash at all.
`test_the_criteria_hash_is_stored_at_creation` and the walkthrough both recompute
it independently rather than calling the server helper.

---

## Where this could go wrong

**Stage 3 is the risk.** It touches auth and rewrites the registration test
file. If it runs long, better to stop and say so than push through — the other
stages are independently verifiable, so a hard stop there costs nothing
downstream.

**Stage 6's deletion of the `local` state is a browser-verified claim, not a
test-verified one.** It is read from the code and looks unreachable under global
accounts, but it gets confirmed at Stage 6, not before.

---

## Commands

```bash
cd "/Users/hari/projects/01-code-projects/crypto project/versions/v4"

python3 -m pytest tests/ -q -p no:randomly     # 101 passed, ~10s
cd frontend && npm run build                    # clean
ZV_TEST_SCRYPT_N=262144 python3 -m pytest ...   # real-cost run (~3.5 min)
python run.py --bootstrap-code                  # first-admin bootstrap code
```