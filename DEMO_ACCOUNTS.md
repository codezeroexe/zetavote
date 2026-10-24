# Demo accounts

Made-up people for demonstrating ZetaVote. Created by `python scripts/seed_demo.py`
(it only runs when `data/` does not exist yet). To start over: stop the server,
delete `data/`, and run the script again.

## Admin

| Name | Passphrase |
| --- | --- |
| Demo Admin | `demo-admin-pass` |

Master passphrase for every demo election (needed to close voting and count votes):
`demo-master-pass`

## Voters

Every voter signs in with the passphrase `demo-voter-pass`.
When a voter votes in an election they joined, the passphrase for that election is
`demo-ballot-pass`.

| Username | Name | Born | What they show |
| --- | --- | --- | --- |
| `asharao0142` | Asha Rao | 1996 | Joined Student council but has not voted yet; can join Library hours |
| `benokafor0007` | Ben Okafor | 2001 | Has voted in three elections |
| `chenwei1234` | Chen Wei | 1988 | Has voted in three elections |
| `danasilva0311` | Dana Silva | 2010 | Under 18: not eligible for Library hours |
| `elifkaya0420` | Elif Kaya | 1999 | Can join Student council |
| `farahhaddad0815` | Farah Haddad | 2003 | Has voted in Student council and Library hours |

## Elections

| Election | State | Try this |
| --- | --- | --- |
| Club budget 2026 | Results out | Any voter: See results. Library books won 3 of 5 |
| Sports day date | Closed, ready to count | Admin: Count votes |
| Student council 2026 (16+) | Open, 3 votes | Asha: Vote. Elif: Join, then Vote. Admin: Close voting |
| Library hours (18+) | Open, 1 vote | Asha: Join and Vote. Dana: not eligible |

Votes seeded by the script were cast outside the browser, so no receipt for them is saved
in the browser. Votes you cast during the demo get a receipt as usual.
