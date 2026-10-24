# Polling station redesign: implementation plan

Source of truth for the look and the per-screen changes: `mockups/before-after/reveal.html`.
The right-hand ("after") layer of each slider is the target. The style board at the top of that
file defines tokens, type, and the ballot stub.

## Rules for every agent

- Work only in `versions/v4/frontend/`. Never touch `backend/`, `tests/`, or `src/services/crypto.ts`.
- Edit only the files your brief assigns you. If you need a change in a file you do not own, stop
  and say so in your report.
- Desktop only. No phone or tablet layouts.
- Privacy invariant: a voter's choice never appears in a receipt, a verify response, or the audit
  view. Keep it that way.
- Do not disable a submit button to signal invalid input. Keep it enabled, validate on submit,
  and show the problem inline with the `Field` `error` prop. `disabled` is only for in-flight requests.
- Sentence case for every title, label, button, and table heading. No `text-transform: uppercase`
  on new rules.
- Minimum text 12px. Controls 36px tall (32px for small buttons).
- Respect `prefers-reduced-motion`.
- Do not commit. Do not add dependencies (the foundation agent alone adds the font package).
- Finish with `npm run build` passing (and `npm run lint` with no new errors), then report the
  files changed and anything you could not do.

## Glossary (use these words in the UI)

| Old | New |
| --- | --- |
| Ballot commitment, commitment | Receipt code |
| Reveal salt | Private key for this receipt |
| Enrol, enrolment | Join, joined |
| Ballot passphrase | Passphrase for this election |
| Punch, Punch this card? | Cast vote |
| Sealed, Ballot sealed | Vote recorded |
| Close an Election / Close election | Close voting |
| Tally, Tally complete | Count votes, Votes counted |
| Merkle root | Results fingerprint (technical name only inside a "Technical details" `<details>`) |
| Audit chain | Activity record |
| First-Run Code | Setup code |
| "64-character SHA-256 hash" errors | "Receipt codes are 64 letters and numbers. This one has N. Paste it again." |

Technical names may stay in code identifiers and inside "Technical details" disclosures.

## Phase 1: foundation (one agent, blocking)

Owns: `src/theme.css`, `src/index.css`, `src/main.tsx`, `index.html`, `src/App.tsx`, `src/App.css`
(shared rules only), `src/hooks/useTheme.ts`, `src/components/**`, `scripts/zv_contrast.py`,
`package.json`, new `src/styles/*.css`, new `src/hooks/useSubmitShortcut.ts`.

1. Font: add `@fontsource-variable/public-sans`, import it in `main.tsx`, set `--zv-font-sans`
   to Public Sans. Keep IBM Plex Mono for codes. Enable tabular numbers on counts.
2. Tokens (light, mirror the style board): slate #1B2A41 ink and sidebar, sky #3BA7E0 primary
   fill with slate label, sky ink #1F5F86 links and open status, red #B4232A irreversible only,
   page #EEF2F6, card #FFFFFF, border #D5DCE5, input border #8A95A8, muted #55627A. Card radius
   10px, control radius 8px, no card shadows. Give dark-theme equivalents. Update the hex tables
   in `scripts/zv_contrast.py` and make `python3 scripts/zv_contrast.py tokens` pass.
3. Shell: replace the top `Navbar` with a left sidebar (196px, slate). Brand at top, section
   links in the middle with a 3px sky bar on the selected item, account name, sign out, and
   the theme control at the bottom. Main content to the right. Keep `aria-current` and keyboard
   order.
4. Theme: `useTheme` gains `"auto"` (default when nothing is stored) that follows
   `prefers-color-scheme` live; the control becomes Auto / Light / Dark. Update the pre-paint
   script in `index.html` to match.
5. Shared components:
   - `components/common/Stub.tsx`: the ballot stub wrapper (dashed tear line, side notches,
     optional mono `id` label at top right). Slides in once on mount; no motion under reduced motion.
   - `components/common/StatusPill.tsx`: word plus shape (dot = open/active, square = closed,
     check = done). Props: `tone: "open" | "done" | "closed" | "danger"`, `children`.
   - Restyle `Stepper` to rounded pills matching the mock.
   - `hooks/useSubmitShortcut.ts`: submits the given form ref. Shortcuts auto-detect the OS:
     Meta and "⌘↵" on Mac, Ctrl and "Ctrl+Enter" elsewhere. Button takes a semantic shortcut
     prop and renders the platform label plus `aria-keyshortcuts`. Pages never hard-code ⌘.
6. Create empty `src/styles/account.css`, `src/styles/voter.css`, `src/styles/verify.css`,
   `src/styles/admin.css` and import them from `main.tsx`, so phase 2 agents never edit App.css.

## Phase 2: screens (four agents in parallel, after phase 1)

| Agent | Screens (reveal.html sections) | Owns |
| --- | --- | --- |
| Account | 1 Sign in, 2 Create account, 3 First run | `pages/Login/*`, `styles/account.css` |
| Voter flow | 5 Your ballots, 6 Join, 7 Cast vote, 8 Receipt | `pages/Voter/VoterDashboard.tsx`, `Enrol.tsx`, `CastVote.tsx`, `styles/voter.css` |
| Proof | 9 Results, 10 Verify | `pages/Voter/ResultsPanel.tsx`, `pages/Verify/*`, `styles/verify.css` |
| Admin | 11 Elections, 12 Create election, 13 Close voting, 14 Count votes, 15 Block, 16 Audit log | `pages/Admin/*`, `styles/admin.css` |

## Phase 4: motion system (queued, after phase 3)

Requested by the user. Scope to be proposed after review: motion tokens, page and panel
transitions, list and table changes, feedback moments (stub, success), reduced-motion fallbacks.

## Phase 3: review (orchestrator)

Build, lint, `pytest -q` (backend untouched, should stay green), contrast gate, glossary grep for
leftover jargon, disabled-submit grep, then a browser pass against reveal.html at 1280px.
