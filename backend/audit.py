"""Append-only, hash-linked audit log.

Every entry carries the hash of the entry before it, so editing or removing any
line invalidates every hash after it. The log is a plain text file on purpose:
a reviewer can read it with `cat` and independently recompute the chain without
running this project.

    entry_hash[n] = SHA256(entry_hash[n-1] + " | ".join(fields[n]))
    entry_hash[0] = GENESIS

The README described a per-election genesis. This uses one global chain, which
also catches an entry being moved between elections.
"""

from .config import AUDIT_LOG_PATH
from .crypto import sha256_hex

GENESIS = sha256_hex("voting_audit_v1")

# field order in the file; the two hash columns are appended by this module
FIELDS = ("timestamp", "election_id", "actor", "action", "detail", "status")


def _hash_line(previous_hash: str, body: str) -> str:
    return sha256_hex(f"{previous_hash} | {body}")


def _read() -> list[dict[str, str]]:
    if not AUDIT_LOG_PATH.exists():
        return []
    entries = []
    for line in AUDIT_LOG_PATH.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) == 8:
            entries.append(dict(zip(FIELDS, parts[:6], strict=True), prev_hash=parts[6], entry_hash=parts[7]))
    return entries


def append(*, timestamp: str, election_id: str, actor: str, action: str, detail: str, status: str) -> str:
    """Append one entry and return its hash. `detail` must not contain '|'."""
    existing = _read()
    previous_hash = existing[-1]["entry_hash"] if existing else GENESIS
    body = " | ".join((timestamp, election_id, actor, action, detail, status))
    entry_hash = _hash_line(previous_hash, body)
    line = f"{body} | {previous_hash} | {entry_hash}\n"
    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as handle:
        handle.write(line)
    return entry_hash


def verify() -> dict[str, object]:
    """Recompute the whole chain. Reports the first index that fails."""
    entries = _read()
    previous_hash = GENESIS
    for index, entry in enumerate(entries):
        body = " | ".join(entry[field] for field in FIELDS)
        expected = _hash_line(previous_hash, body)
        if entry["prev_hash"] != previous_hash or entry["entry_hash"] != expected:
            return {"valid": False, "entries": len(entries), "broken_at": index, "genesis": GENESIS}
        previous_hash = entry["entry_hash"]
    return {"valid": True, "entries": len(entries), "broken_at": None, "genesis": GENESIS}


def contains(election_id: str, commitment: str) -> bool:
    """Was this commitment ever recorded in the chain?"""
    return any(e["election_id"] == election_id and e["detail"] == commitment for e in _read())


def tail(limit: int = 50) -> list[dict[str, str]]:
    return _read()[-limit:][::-1]
