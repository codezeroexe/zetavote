# ZetaVote — Changes Required

Usability, UI and correctness audit of `versions/v4`.

**Scope:** `frontend/src` (React 19 + Vite, no router, no UI kit), `backend/app.py`,
`backend/database.py`, `README.md`, `run.py`.
**Date:** 2026-10-01
**Method:** full read of every frontend source file, static analysis of CSS usage,
contrast maths against the token set, and live runs of the server.

**How to read this:** `P0` blocks the app from working at all. `P1` sends a user
down the wrong path or tells them something untrue. `P2` is friction in a core
journey. `P3` is accessibility. `P4` is hygiene and copy.

Every finding names the file and line so it can be actioned directly.

---

## Summary

| Area | P0 | P1 | P2 | P3 | P4 |
|------|----|----|----|----|----|
| Blocks startup / no UI served | 2 | – | – | – | – |
| Navigation & information architecture | – | 6 | – | – | – |
| Copy that misleads | – | 6 | – | – | 3 |
| Core journey friction | – | – | 17 | – | – |
| Accessibility | – | – | – | 10 | – |
| Dead code & duplication | – | – | – | – | 4 |
| **Total** | **2** | **12** | **17** | **10** | **7** |

The codebase is unusually well commented and the security reasoning is sound.
The problems are almost entirely in the layer between the crypto and the human:
navigation that goes nowhere, copy that describes a data model that was deleted,
and a dark theme whose state indicators are measurably invisible.

---

## P0 — The app does not run

### P0-1 · `python run.py` crashes on startup

```
$ python3 run.py
File "backend/database.py", line 136, in init_db
    conn.execute(
sqlite3.OperationalError: no such column: dob
```

Reproduced against the `data/elections.db` in this working tree.

`init_db()` creates `accounts` with `CREATE TABLE IF NOT EXISTS`
(`backend/database.py:120`) and therefore **never upgrades an existing table**.
`_add_column` is called only for `elections.min_age`, `elections.max_age` and
`elections.criteria_hash` (`backend/database.py:207-213`) — never for
`accounts.dob`. The database on disk is the older schema, where the column is
`dob_hash`:

```
accounts  ['id', 'name_hash', 'dob_hash', 'public_key', 'sealed_key', 'created_at']
```

So `CREATE INDEX idx_accounts_identity ON accounts(name_hash, dob)`
(`backend/database.py:136`) raises against a table that was left untouched.

**Impact:** no server, no pages, no API. `scripts/browser_walkthrough.py` is dead
for the same reason — `import backend.audit` runs `backend/__init__.py`, which
imports `backend.app`, which calls `init_db()` against the real file before the
script can point it at a sandbox. Every `pytest` session that imports the app
fails the same way.

**Required fix**
1. Make the schema authoritative rather than best-effort. Record a schema version
   in `meta`; on mismatch, stop with an actionable message naming the file path
   and the remedy instead of a bare `sqlite3` traceback.
2. Add the missing migration for `accounts.dob`, or state plainly that v3
   databases are not supported and must be deleted.
3. `data/` is gitignored, so nothing in the repo prevents this state — the
   first-run experience is "unhandled exception", which is the worst possible
   first impression for a voting app.

### P0-2 · The backend never serves the frontend

`backend/app.py` contains no `StaticFiles`, no `app.mount()` and no
`FileResponse`. Verified against a running server:

```
GET /            → 404  {"detail":"Not Found"}   (application/json)
GET /api/health  → 200  {"status":"ok"}
```

`README.md:48-50`, `README.md:600-613` and `README.md:44-50` all tell the user to
run `python run.py` and open `http://localhost:8080`. That URL serves a JSON 404.
The only way to see the UI today is a second terminal running `npm run dev` on
port 5173, which the quick-start section never mentions.

**Required fix**
1. Mount `frontend/dist` with `StaticFiles(directory=..., html=True)` after the API
   routes, with an index fallback.
2. `pyinstaller.spec:9` has `datas=[]`, so a packaged build ships the API with no
   UI at all. Add the dist directory and the fonts/icons it references.

---

## P1 — Navigation and information architecture

### P1-1 · A signed-out visitor gets a bare login card

`App.tsx:36-41` renders `LoginPage` whenever the section is `login`.
`LandingPage.tsx` is never imported — grep confirms zero references.

Consequences, all of them user-facing:
- Nothing explains what the application is before it asks for credentials.
- The **prototype-scope disclaimer is unreachable.** It lives only in
  `LandingPage.tsx:150-162`. For a voting product, "not intended for binding
  real-world elections" is the single most important thing on the first screen
  and it currently appears nowhere.
- The feature overview (`LandingPage.tsx:79-147`) is dead content.
- The "Verify Ballot" entry point (`LandingPage.tsx:61-75`) is unreachable.

**Fix:** render `LandingPage` when `section === "login" && role === null`, with
Sign in / Register as the primary actions. Keep the disclaimer above the fold.

### P1-2 · The public verification tool is hidden behind sign-in

`Navbar.tsx:35-42` only builds tabs when `role !== null`. But
`GET /api/elections/{id}/verify/{commitment}` (`backend/app.py:1572`) requires no
session. An observer verifying a published ballot — the app's strongest trust
story — cannot reach the feature without an account.

**Fix:** always render the VERIFY tab. Signed out, it is the only route in.

### P1-3 · Clicking the logo signs you out of the view, not the session

`Navbar.tsx:53` calls `onNavigate("login")`, which sets `manualSection`.
`App.tsx:32-34` prefers `manualSection` over the session, so a signed-in admin who
clicks the brand lands on the sign-in form while still authenticated. There is no
brand link back to their own dashboard.

**Fix:** the brand returns to the session's home section.

### P1-4 · No URL, no back button, no deep links

All navigation is a single `useState` in `App.tsx:15`. Reload discards the current
section, browser Back does nothing, and no view is linkable.

This matters more than usual here: the create-election flow tells the admin to
share the election id (`CreateElection.tsx:100`) and the verify flow asks someone
to paste a commitment — but a link such as `#/verify/<election>` is exactly what
should be shareable.

**Fix:** the cheap version is `location.hash` plus a `popstate` listener. A router
is not required.

### P1-5 · Sign Out is at the bottom of a scrolling page

`VoterDashboard.tsx:134-150` and `AdminPage.tsx:62-66` render it after the content.
On a list of a dozen elections the user scrolls to find it.

**Fix:** navbar, next to the signed-in subject.

### P1-6 · Switching admin tabs silently deletes a half-filled form

`AdminPage.tsx:58-60` mounts `{tab === "create" && <CreateElection />}`. Create
Election holds ten fields including the master passphrase
(`CreateElection.tsx:39-47`). Clicking "Audit Chain" unmounts it and every value
is lost, with no warning.

**Fix:** keep panels mounted and toggle with `hidden`, or lift the draft into
`AdminPage`.

---

## P1 — Copy and data that mislead

### P1-7 · Enrolment success message prints "Line undefined"

`Enrol.tsx:91`:

```
Line ${result.roster_ordinal} of this election's eligible list is yours.
```

The live enrol route returns only `{election_id, username}`
(`backend/app.py:1094`). `roster_ordinal` is a leftover from the deleted roster
model — `tests/conftest.py:105` states plainly "There is no roster any more", and
no schema table creates one. `types/api.ts:195` and `Enrol.tsx:40` still declare
the field, and `Enrol.tsx:102` writes `"roster_ordinal": undefined` into the
downloaded receipt.

**Fix:** remove the field from the type and the receipt. The confirmation should
say what actually happened — you are enrolled, this election only.

### P1-8 · The verify page claims success before checking

`VerifyPage.tsx:52-58` renders `type="success" title="✓ Ballot Valid"` whenever a
result object exists. Thirteen lines later, `VerifyPage.tsx:63-65` renders
`result.valid ? "✓ RECORDED & VALID" : "INVALID"`.

A verification that comes back invalid therefore shows a green "Ballot Valid"
banner directly above a red "INVALID" row.

**Fix:** derive the banner type and title from `result.valid` and the `checks`
object. There is already a pattern for this at `ResultsPanel.tsx:219-228`.

### P1-9 · "My Receipt" opens the published results

`VoterDashboard.tsx:248-251` sets `action.kind = "results"`, which renders
`ResultsPanel` on its default `summary` tab (`ResultsPanel.tsx:33`, `:65`) — the
public tally. The voter's own receipt is nowhere on screen.

**Fix:** either rename the button to "View Results", or add a receipt panel that
reads the voter's stored commitment from `loadBallotSeal` (`crypto.ts:378`).

### P1-10 · The election name is dropped when joining or voting

`VoterDashboard.tsx:127-129` captures `name`, but only `ResultsPanel` receives it.
`Enrol.tsx:133-136` and `CastVote.tsx:192-194` show the raw id alone:

```
Enrolling in election_2026 as asha0142
```

Voters recognise elections by name. The name is already in hand.

**Fix:** pass it through — `Enrolling in Student Council 2026 (election_2026)`.

### P1-11 · Every 401 reports "Invalid master passphrase"

`api.ts:73`:

```ts
if (status === 401) return "Invalid master passphrase";
```

A voter sign-in failure, an expired session and a tally with the wrong passphrase
all produce the same message about a passphrase most voters have never set.

**Fix:** map by status and calling context, or drop the generic line and let the
endpoint-specific entries speak.

### P1-12 · Error translation is keyed on exact backend strings

`api.ts:39-67` matches the literal `detail` text from `backend/app.py`. Any
reword on the server silently drops the friendly message and the raw internal
string reaches the user. `Election not found`, `Unknown username` and
`Voter access required` have no entries at all, and `window_open` /
`registration_shut` return several more untranslated strings.

**Fix:** return a stable machine-readable `code` beside `detail`, or key the map
on status plus endpoint. Do not depend on prose staying still.

### P1-13 · Registration never warns that the passphrase is unrecoverable

`LoginPage.tsx:441-456` explains that the passphrase "seals your key" and stops
there. It does not say that losing it ends the account permanently — and the
server genuinely cannot help: `run.py --reset-admin` (`admin_cli.py`) resets only
the admin. The same applies to the per-election ballot passphrase
(`Enrol.tsx:138-148`), where losing it means that enrolment can never vote again,
and the hint actively encourages using a *different* passphrase.

This is the highest-consequence gap in the app for a non-technical user, and it
is the one that produces a support request with no possible answer.

**Fix:** warning alert above the field, plus a confirm-passphrase input, on both
the account and the ballot passphrase.

---

## P2 — Friction in the core journeys

### P2-1 · No copy button anywhere
Every value the app asks a user to retain or share must be selected by hand:
ballot commitment (`CastVote.tsx:136`), reveal salt (`CastVote.tsx:141`),
election id (`CreateElection.tsx:105`, `VoterDashboard.tsx:192`), election public
key (`CreateElection.tsx:125`), Merkle root (`ResultsPanel.tsx:162`,
`TallyElection.tsx:128`), criteria hash, and audit entry hashes.

The CSS for this already exists and is unused: `App.css:2356-2390` defines
`.zv-id-callout*` with `user-select: all`, a large monospace value and a hint line.

**Fix:** a copy control on every `.zv-merkle-hash` and id, using
`navigator.clipboard.writeText` with a transient "Copied" state.

### P2-2 · Admin types the election id to close or tally it
`CloseElection.tsx:109-117` and `TallyElection.tsx:139-149` are free-text fields,
while the list of elections is rendered directly above on the same screen
(`AdminPage.tsx:118-185`). A typo produces "Election not found".

**Fix:** a `<select>` of the elections on screen, or per-row Close / Tally /
Blocked buttons that prefill the id.

### P2-3 · Master passphrase: no confirmation, no minimum, warning too late
`CreateElection.tsx:56-57` — `canSubmit` ignores the passphrase entirely. The
field has `required`, so the browser throws its own bubble, but there is no
`minLength`, so a four-character passphrase submits and fails server-side.
There is no confirmation field, so a typo is accepted silently.

The consequence is stated at `CreateElection.tsx:127-131` — "cannot be recovered
or reset" — but that warning appears **after** a successful create. By then the
election is unclosable and untallable forever.

**Fix:** confirm field, `minLength={8}`, and move the irreversibility warning
above the input.

### P2-4 · Create Election has no cross-field validation
- `min_age` greater than `max_age` passes client-side (`CreateElection.tsx:184-206`).
- `ends_at` before `starts_at` passes (`CreateElection.tsx:215-228`).
- `datetime-local` shows no timezone, while the value is converted with
  `new Date(...).toISOString()` (`CreateElection.tsx:69-70`). The admin cannot
  tell which instant they are setting.

**Fix:** inline errors for the two inversions; show the resolved local time and
UTC offset beside each field.

### P2-5 · Native browser validation fights the app's own error design
Forms rely on `required` for native bubbles while `Field` renders its own
`.zv-form-error-hint` (`Field.tsx:52`). Two error systems, two looks, and native
tooltips are unstyleable.

**Fix:** `noValidate` on the forms; validate in `Field` and `useSubmit`; one error
style everywhere.

### P2-6 · The voter's own commitment is never prefilled
`ResultsPanel.tsx:231-241` and `:327-334` ask the voter to paste a 64-character
hash that this same browser stored in `localStorage` via `saveBallotSeal`
(`crypto.ts:367`). `VerifyPage.tsx:144-164` does the same.

**Fix:** prefill from `loadBallotSeal` and offer a paste button alongside.

### P2-7 · Verify does not normalise the pasted hash
`VerifyPage.tsx:22-24` trims, then sends the value as typed. A hash copied out of
the downloaded JSON can carry different casing or a trailing newline; the
commitment is hex, so the comparison fails and a valid ballot reads as invalid.

**Fix:** `value.trim().toLowerCase().replace(/\s+/g, "")` before the request, and
echo the normalised value so the user can see what was actually looked up.

### P2-8 · Session expiry is a dead end
A 401 mid-flow only paints an alert — `AdminPage.tsx:84-87`, "Your session may
have expired." Nothing signs the user out and nothing offers the way back. Every
subsequent action fails identically.

**Fix:** intercept 401s from `/api/*` outside the login calls, clear the session,
and return to sign-in with "Your session expired — sign in again."

### P2-9 · The audit view misrepresents its own scope
`AdminPage.tsx:307` hardcodes `getAudit(undefined, 100)`. The table
(`AdminPage.tsx:373-401`) shows only `toLocaleTimeString()` — no date, no seconds —
so entries from different days are indistinguishable. There is no "showing the
latest 100 of N", no pagination, and the filter is case-sensitive substring
matching over three fields (`AdminPage.tsx:322-328`).

**Fix:** state the window and total, add date and seconds, make the filter
case-insensitive, add an election dropdown, and paginate.

### P2-10 · "Backend Offline" blocks nothing
`BackendStatus.tsx:29-47` shows a pill and a Retry button; every form stays live
and fails at submit with "Backend unavailable" (`api.ts:108`). For a local app the
most common failure is "the server is not running", and it presents as a generic
error on whatever form the user happened to be on.

**Fix:** a banner that states the server is unreachable and disables submits while
it is.

### P2-11 · The close confirmation names an id, not an election
`CloseElection.tsx:84-87`: "Closing election `election_2026` is permanent." With
several elections open there is nothing to check that against.

**Fix:** resolve the id to its name in the confirmation.

### P2-12 · Unblock has no confirmation
`BlockList.tsx:146-152` reverses a block on a single click with no confirmation and
no undo.

### P2-13 · No first-run path for the admin
After bootstrap the admin lands on an empty state (`AdminPage.tsx:110-116`): "No
elections yet. Use the New Election tab to create one." The first-run code is
explained only inside the form (`LoginPage.tsx:152-158`).

**Fix:** a short numbered checklist on the empty state — create an election, share
the id, enrol yourself, close, tally — and surface the first-run code instruction
before the field, not after.

### P2-14 · No help for a forgotten username or passphrase
`LoginPage.tsx:276` warns that case matters and gives a fictional example. Beyond
that there is no guidance, because no recovery exists.

**Fix:** state the position plainly on the sign-in form. Better, offer a local
reminder of the account id at registration time.

### P2-15 · The button label vanishes while loading
`Button.tsx:26-31` replaces children with a spinner, so a loading "Create
Election" button reads "Loading" with no label. It also changes width mid-click,
which shifts the layout of every form action row.

**Fix:** keep the label, disable the button, and place the spinner beside the text.

### P2-16 · Voters join blind
`VoterDashboard.tsx:188-227` shows the name, description, state pill and counts —
but not the candidate list, and not the eligibility rule that will decide whether
they may join. The rule is computed server-side (`backend/app.py:1461`) and only
ever rendered after a tally (`ResultsPanel.tsx:167-172`), even though
`describeCriteria` (`services/ageRule.ts`) is already imported in the voter bundle
via `CreateElection`.

**Fix:** show the candidates and the age rule on the election card.

### P2-17 · The countdown says nothing when there is no end date
`VoterDashboard.tsx:264-284` returns `null` for a null `ends_at`, so an
open-ended election shows no timing whatsoever. The admin view handles this case
("No end date set", `AdminPage.tsx:280-282`); the voter view does not.

---

## P3 — Accessibility

### P3-1 · Every "tablist" is a broken tab widget
`Navbar.tsx:73-95`, `LoginPage.tsx:59-81`, `AdminPage.tsx:37-56`,
`ResultsPanel.tsx:44-63` all use `role="tablist"` with `role="tab"` children and
no `role="tabpanel"`, no `aria-controls`, and no arrow-key handling. Assistive
technology announces tabs that control nothing, and arrow keys do nothing.

**Fix:** drop the roles and use `aria-pressed` toggle buttons — honest, simpler,
and keyboard-correct. Implement the full pattern only if it is done properly.

### P3-2 · `Field` gives assistive technology no error or hint association
`Field.tsx:37-53` renders the hint and the error as bare `<span>`s inside the
`<label>`, with no ids, no `aria-describedby`, and no `aria-invalid` on the
control. A screen reader user hears the label and nothing else.

**Fix:** generate ids from the label, wire `aria-describedby` to hint and error,
and set `aria-invalid` when an error is present.

### P3-3 · `Alert` is `role="alert"` for all four types
`Alert.tsx:46`. Informational and success boxes interrupt the user as alerts, and
on `VerifyPage` the success banner fires the moment the result arrives.

**Fix:** `role="status"` for info and success; keep `role="alert"` for error and
warning.

### P3-4 · Focus is never managed on view change
Nothing moves focus when a tab, a login mode or a dashboard action changes
(`App.tsx:36-41`, `AdminPage.tsx:58-60`, `VoterDashboard.tsx:65-92`). Focus falls
back to `<body>` and the next screen is announced from the top of the document —
often several hundred pixels away from where the user is looking.

**Fix:** move focus to the new view's heading on change.

### P3-5 · No skip link
Every page begins with five or six tab stops in the navbar before any content.

### P3-6 · `<main>` has no id
`App.tsx:54` — so a skip link has nothing to target.

### P3-7 · No error boundary and no `<noscript>`
A thrown render leaves a blank page with no recovery. `index.html` has no
`<noscript>` fallback.

**Fix:** an error boundary that names the error and offers a reload.

### P3-8 · Long hashes overflow narrow viewports
`.zv-merkle-hash` has no `overflow-wrap`, so a 64-character commitment on a phone
either overflows or is clipped. `.zv-hash-truncate` (`AdminPage.tsx:391-393`)
truncates audit hashes with no `title` attribute and no way to recover the rest.

**Fix:** `overflow-wrap: anywhere` on hash blocks; `title` plus a copy action on
audit hashes.

### P3-9 · No show/hide toggle on any passphrase field
Nine passphrase inputs across the app, all permanently masked. A mistyped
passphrase is unrecoverable (P1-13), and a reveal toggle is the cheapest possible
confirmation.

### P3-10 · `<head>` has no `theme-color`
`index.html:5-11`. The mobile browser chrome stays on the default colour against
a black app. Add it per theme.

### P3-11 · Dark-theme state indicators fail the 3:1 non-text contrast target

Measured against the tokens in `theme.css` (dark card `#1f150c`):

| Element | Token | Ratio |
|---|---|---|
| `.zv-choice-option.selected` border (`App.css:2431`) | `#412d15` | **1.38:1** |
| Radio `accent-color` (`App.css:2436`) | `#412d15` | **1.38:1** |
| `.zv-state-ready` left border (`App.css:2552`) | `#412d15` | **1.38:1** |
| `.zv-state-none` left border (`App.css:2562`) | `#38322a` | **1.42:1** |
| `.zv-input` border (`App.css:1174`) | `#38322a` | **1.42:1** |

In dark theme the input fill (`--zv-input-bg: #1f150c`) is identical to the card
fill, so a form field's boundary is a 1.42:1 hairline against its own background.

The consequences are concrete:
- **Which candidate is selected is nearly imperceptible.** The only reliable cue is
  the native radio dot, itself at 1.38:1. For a ballot, a mis-click is a mis-vote.
- The comment at `App.css:2550` claims the left border marks the state "so the
  three voter states are distinguishable without reading the pill". In dark theme
  "Joined — ready to vote" and "Open — you can join" have invisible markers; only
  "missed" and "voted" are visible.
- Form field edges are hard to locate.

Text contrast is otherwise good and needs no work: muted text measures 5.9:1 on
cards, primary button text 9.5:1 dark and 13.0:1 light. The one borderline pair is
`--zv-muted` on the light page background (`#6f6353` on `#e1dcc9`) at 4.26:1,
which is below 4.5:1 for body text — it is used for `.zv-count-label` and
`.zv-countdown`, both small.

**Fix:** in dark theme, raise `--zv-primary` and `--zv-border-strong` to a lighter
bronze for these non-text uses (roughly `#8a6a3c` clears 3:1 on `#1f150c`), or
introduce a dedicated `--zv-state-accent` so brand colour and indicator contrast
stop being the same value.

---

## P4 — Dead code, duplication and copy

### P4-1 · Roughly 570 lines of shadowed duplicate routes
`health`, `api/health`, `create_election`, `list_elections`, `get_election` and
`enrol_account` are each registered twice — `backend/app.py:830-1104` and
`backend/app.py:1108-1400`.

The second block is the deleted roster model. It queries a `roster` table that
`init_db` no longer creates, and it only appears to work because Starlette keeps
the first matching route. Reorder those definitions — or add the health endpoint
in one place and let the duplicate drop to the end of the file, where it is
invisible — and every enrolment fails with `no such table: roster`.

**Fix:** delete `backend/app.py:1108-1400`. Then confirm the enrolment and
duplicate-account behaviour still holds; `tests/test_blocks.py:5` and
`tests/test_enrolment.py:79` describe exactly the guarantee at risk.

### P4-2 · Dead frontend
- `LandingPage.tsx` — 165 lines, never rendered (see P1-1).
- `VoterDashboard.tsx:298` — `export { ZvMark }`, re-exported and unused.
- 27 CSS classes with no reference in any `.tsx`: `zv-hero-logo`,
  `zv-id-callout{,-label,-value,-hint}`, `zv-register-success`, `zv-role-toggle`,
  `zv-choice-field`, `zv-choice-input`, `zv-admin-row`.

  Note `zv-choice-input` is dead because `CastVote.tsx:208-222` styles the radio
  through `.zv-choice-option input` instead — two competing style paths for the
  same control, only one of which is live.

### P4-3 · One rule, three copies
`MIN_PASSPHRASE = 8` at `LoginPage.tsx:19` and `CreateElection.tsx:11`, both
commented "must match MIN_PASSPHRASE in backend/app.py" — `backend/app.py:40`.
Change the server value and two client validations silently drift out of step.

**Fix:** return it from `/api/health` or a config endpoint and read it once.

### P4-4 · `formatDuration` written twice
`VoterDashboard.tsx:286-296` and `AdminPage.tsx:286-296` are identical, with a
third `msRemaining` helper beside the first. Move to `services/format.ts`.

### P4-5 · Inconsistent register
`Navbar.tsx:62` and every badge render as ALL CAPS monospace
(`letter-spacing: 0.06em`, `text-transform: uppercase`), while countdown values,
result values and status text are sentence case. The footer badge claims
"FastAPI v0.1.0" (`Footer.tsx:17`) while the backend is version `0.4.0`
(`backend/app.py:39`).

**Fix:** settle on one register; show no version rather than a stale one.

### P4-6 · The login page heading does not match the task
`LoginPage.tsx:43-44` hardcodes the badge `SIGN IN` and the title `ZetaVote` for
every mode — including REGISTER and the admin bootstrap form. The heading should
name what the user is doing.

### P4-7 · No frontend tests
`package.json` has no test script and no runner. The crypto contract is covered
from Python (`tests/test_crypto_parity.py`), which is the right call. The gaps
worth a first pass are the ones above that are silent rather than loud: the
verify banner (P1-8), the enrolment copy (P1-7), and `Field`'s aria wiring.

---

## Suggested order of work

**1 — Make it run.** P0-1, then P0-2. Nothing else can be checked by a human
until the server starts and serves a page.

**2 — Fix what is actively untrue.** P1-7, P1-8, P1-11, P1-12. Each is a small
edit with a large trust cost, and each is a screen a user reads as fact.

**3 — Restore the map.** P1-1 (landing + the scope disclaimer), P1-2 (public
verify), P1-3 (brand link), P1-5 (sign out), P1-4 (hash routing, last).

**4 — Dark theme contrast.** P3-11. One token change fixes four measured
failures and makes the selected candidate legible, which matters more than its
line count suggests.

**5 — Retire the copy traps.** P1-6 (tab state loss), P1-10 (election name),
P1-9 (misnamed button), P2-3, P2-4.

**6 — Give the user their data back.** P2-1 (copy buttons, reusing the CSS that
already exists), P2-6, P2-7, P2-17.

**7 — Protect the unrecoverable.** P1-13, P3-9. The warning has to exist before
the field, on both passphrases.

**8 — Accessibility sweep.** P3-1 through P3-8, P3-10, P3-11.

**9 — Journey friction.** P2-2, P2-8, P2-9, P2-10, P2-13, P2-16.

**10 — Deletion.** P4-1 (570 dead backend lines), P4-2, P4-3, P4-4, P4-5, P4-6.

---

## Verification performed

| Command | Result |
|---|---|
| `python3 run.py` | **fails** — `sqlite3.OperationalError: no such column: dob` |
| `uvicorn backend.app:app` → `GET /` | 404 `application/json` (no static mount) |
| `uvicorn backend.app:app` → `GET /api/health` | 200 `{"status":"ok"}` |
| `npm run lint` (oxlint, 31 files) | 0 warnings, 0 errors |
| `npx tsc -b` | clean |
| CSS class reference sweep | 177 classes, 27 unreferenced |
| Contrast maths vs `theme.css` | 4 dark-theme pairs below 3:1; text pairs pass |

The `data/` directory was inspected and restored to its original state; no
application data was modified.
