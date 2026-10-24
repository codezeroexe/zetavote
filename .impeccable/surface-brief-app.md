# Surface brief — ZetaVote application shell

Scope: the whole app (shell, front door, admin, voter, cast vote, results,
verify, shared components). **Replacement visual world**, not an extension: the
previous world (Certified Return, roll `06d8bfa3`) is discarded, not refined.

Visitor mode: **Operate**. First-time voters, facilitator-led demo, one act that
cannot be undone. Build path: code-led (no image generation in this harness, so
no comp round and no `buildPath` toggle).

## Direction contract

**THESIS.** A ballot is a card punched into a stack, and a vote is one hole and
then no trace of it. The category default arranges a voting app as reassurance
above a submit button; this one arranges it as a keypunch desk, where the choice
is a hole punched in a fixed column, the machine prints the receipt beside it,
and the count comes back out as a column of holes you can hold next to a
fingerprint. Certainty is legible before anybody clicks anything.

**OWN-WORLD.** 80-column card stock — buff manila, the only warm surface in the
app — punched and clipped, sitting on a cool graphite machine ground. Two inks
and no third: a cool **punch teal** that means the card is on the machine
(punched, counted, running, proven) and an **oxide red** exception ribbon that
means SEAL — sealed, void, irreversible, broken. States are holes with keyway
shapes, never pills: a filled hole, a keyed slot still open, a chad left
hanging, a struck punch, nothing at all. Type is machine-lettering: every
printed label, state word, column head, figure and hash in fixed-pitch IBM Plex
Mono, running prose in Inter at reading measure only. Ruling is the card's own
field rules and the tray edge; corners square, the card's clip corner is the one
shape that is not a rectangle.

**STORY.** The visitor sees the machine before they are asked to trust it: a
key pattern punched in the card's dead zone, a chain verdict recomputed on load,
a field they fill and a hole they punch. They enrol, vote, keep the receipt,
check a ballot, and read a tally as a column of holes beside the Merkle root
that fingerprints it. Every claim is printed on the same line as the figure
that proves it, because a card carries both.

**FIRST VIEWPORT.** Chrome is a card-stock header strip: mark at the left in a
keyed zone, role-appropriate tabs in the middle punched as slots, identity,
server lamp and theme switch at the right, over a graphite ground. The first
viewport of a signed-in surface is one work area — the election list, one card
per election, each row a card with a clip corner, its state a punched hole and
its figures in a fixed field zone. The primary action sits on that card's own
baseline, in the field the action changes. On the ballot screen the card itself
is the first viewport, at its 2.1:1 proportion, 80 columns wide, with the
candidate field as the one open slot. The signature move lives on the results
screen: the tally is a binary column of holes, decimal figure set beside it.

**FORM.** The Tabulating Card, position 1 of the grounded list, seed key
`1328a8f9`. Committed as a replacement, so nothing of the discarded world
carries over: no ruled ground, no printed state marks, no Seal Indigo, no
square-cornered ledger entry, no horizontal-rules page structure. Raises carried
from the discarded hand, named: two inks and no third (measured, not eyeballed);
a material the app can put a hole in; every state carries a shape before it
carries a colour; irreversible actions wear the exception ribbon and are
two-step; figures are measured quantities in a fixed field.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Admin, cast-vote and post-submit receipt surfaces are built but unreachable
  for capture in this run: the demo admin passphrase is not available and the
  demo voter has already voted in all three elections, so no enrolment on this
  browser holds an uncast ballot. No records were created to reach them.
