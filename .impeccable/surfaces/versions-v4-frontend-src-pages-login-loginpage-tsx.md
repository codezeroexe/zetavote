---
version: 1
slug: "versions-v4-frontend-src-pages-login-loginpage-tsx"
primary_target: "versions/v4/frontend/src/pages/Login/LoginPage.tsx"
related_targets: ["versions/v4/frontend/src/pages/Login/FrontDoor.tsx"]
---

# Front door — the signed-out entry

Scope: the page a visitor sees before signing in (`#/` while signed out). Visitor mode: Persuade.
Build path: code-led (no image generation on this machine). New surface inside an established world; DESIGN.md unchanged.

Audience: someone seeing this for the first time, in a dim room, on a laptop.
Job: understand what this is and how it can be checked, then sign in or register.
Action: the existing sign-in form, in its working form, in the first viewport.
Proof: four guarantees each paired with the mechanism that backs it, plus the live verdict of `GET /api/audit/verify` (entries count, validity, genesis) fetched with no session.
Constraints: no new route, no behaviour change, no existing copy altered, no invented figures, no adoption or benchmark claims.

Chosen direction: two columns, info and sign-in. Memorable moment: the chain verdict appearing in the left column as a real measured figure while the form sits beside it, ready.

Unresolved: whether the admin role sees the same left column (it does — the copy describes the record, not the role).

## Direction contract

THESIS: The signed-out page is the only page a stranger sees, and it currently says "Sign in to vote" and nothing else. It becomes two columns: the record explained on the left, the way in on the right. It refuses the split-hero template it deliberately resembles by letting the left column be ruled clauses and one measured figure, never a headline over subcopy.

OWN-WORLD: Cool near-neutral ground, ruled. Seal indigo spent only where a record is certified; live green for running-and-proven; amber for a person needed; red for destructive. Square 2px marks, 3px containers, the pill only on the state mark. Inter for words, JetBrains Mono for every figure and hash, tabular numerals. No shadow except the certify fill.

STORY: A stranger opens the app and learns in one screen that this is a kept record — four guarantees, each with the mechanism behind it, and the chain's live verdict, all checkable afterwards. Then they type a username and passphrase. Nothing is asserted that a person cannot verify for themselves.

FIRST VIEWPORT: 1120px container, two columns at 821px and wider. Across the top, the lockup as a masthead line spanning both columns. Left: the existing heading and note, then the live chain verdict, then four clause rows. Right: the existing prototype alert, the existing segmented switch, the existing card form with its two fields and its certify button, unaltered. Below 820px it becomes one column, masthead first, then the form, then the explanation.

As built, two details differ from the arrangement first recorded and are the arrangement that shipped: the lockup spans both columns rather than sitting inside the left one, because the columns reorder on a phone and an in-column lockup lands below the form where the dropped navbar wordmark leaves the product unnamed; and the chain verdict sits directly under the note, above the clause rows, so the one measured figure on the page is inside the first viewport.

FORM: Two columns, info and sign-in. Position 1 of 7 grounded candidates by resonance. Seed key 56ce1771, scope surface, mode persuade.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
