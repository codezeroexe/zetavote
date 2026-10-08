"""Merkle tree over ballot commitments.

The previous implementation returned SHA256(election_id + tallied_totals),
which commits to the *result* rather than to the set of ballots. This builds a
real tree over the sorted commitment list, so publishing the root lets anyone
prove a specific ballot was included in the tally.
"""

from .crypto import sha256_hex


def _parent(left: str, right: str) -> str:
    return sha256_hex(f"{left}|{right}")


def build_root(leaves: list[str]) -> str:
    """Root over `leaves`. Odd nodes at any level are promoted unchanged."""
    if not leaves:
        return sha256_hex("zetavote/merkle/empty")
    level = sorted(leaves)
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [_parent(level[i], level[i + 1]) for i in range(0, len(level), 2)]
    return level[0]


def inclusion_proof(leaves: list[str], target: str) -> list[tuple[str, str]] | None:
    """Sibling hashes proving `target` is in the tree, or None if absent."""
    if target not in leaves:
        return None
    level = sorted(leaves)
    index = level.index(target)
    proof: list[tuple[str, str]] = []
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        pair = index ^ 1
        proof.append((level[pair], "right" if index % 2 == 0 else "left"))
        level = [_parent(level[i], level[i + 1]) for i in range(0, len(level), 2)]
        index //= 2
    return proof


def verify_proof(target: str, proof: list[tuple[str, str]], root: str) -> bool:
    digest = target
    for sibling, side in proof:
        # side is where the *sibling* sits, so "right" means digest is the left
        # child and the parent hashes digest first.
        digest = _parent(digest, sibling) if side == "right" else _parent(sibling, digest)
    return digest == root
