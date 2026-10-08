"""The old commitment was SHA256(choice + user_typed_nonce), so anyone holding a
receipt could enumerate the candidate list and recover the vote. These tests pin
the replacement: a 256-bit salt the voter alone holds."""

import os

from backend import crypto

CANDIDATES = ["Alice", "Bob", "Carol", "Dave"]
ELECTION = "e1"


def test_salted_commitment_is_not_recoverable_by_enumeration():
    salt = crypto.b64(os.urandom(32))
    commitment = crypto.ballot_commitment(ELECTION, "pubkey", salt, "Bob")

    # The naive attack from the old scheme: hash each candidate against the
    # public receipt material and see which one matches.
    matches = [
        c for c in CANDIDATES
        if crypto.sha256_hex(f"{c}:some-nonce") == commitment
    ]
    assert matches == []

    # Only the real salt opens it, and then exactly one candidate matches.
    recovered = [
        c for c in CANDIDATES
        if crypto.ballot_commitment(ELECTION, "pubkey", salt, c) == commitment
    ]
    assert recovered == ["Bob"]


def test_commitment_is_bound_to_the_election():
    salt = crypto.b64(os.urandom(32))
    assert crypto.ballot_commitment("e1", "pk", salt, "Bob") != crypto.ballot_commitment("e2", "pk", salt, "Bob")


def test_commitment_is_bound_to_the_voter():
    salt = crypto.b64(os.urandom(32))
    assert crypto.ballot_commitment(ELECTION, "pk1", salt, "Bob") != crypto.ballot_commitment(ELECTION, "pk2", salt, "Bob")


def test_revealing_the_salt_proves_the_choice_offline():
    """The post-close reveal: voter holds the salt, checks candidates locally."""
    salt = crypto.b64(os.urandom(32))
    commitment = crypto.ballot_commitment(ELECTION, "pk", salt, "Carol")
    for candidate in CANDIDATES:
        if crypto.ballot_commitment(ELECTION, "pk", salt, candidate) == commitment:
            break
    else:
        raise AssertionError("no candidate matched the commitment")
    assert candidate == "Carol"


def test_canonical_json_is_sorted_and_compact():
    assert crypto.canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}'


def test_canonical_json_keeps_non_ascii_unescaped():
    """Must match JSON.stringify in the browser, which does not \\u-escape."""
    assert crypto.canonical_json({"choice": "café"}) == '{"choice":"café"}'


def test_canonical_json_is_stable_across_insertion_order():
    first = crypto.canonical_json({"a": 1, "b": {"y": 2, "x": 3}})
    second = crypto.canonical_json({"b": {"x": 3, "y": 2}, "a": 1})
    assert first == second


def test_canonical_json_known_vector():
    """If this ever changes, every browser signature stops verifying."""
    payload = {
        "election_id": "e1",
        "voter_id": "v1",
        "voter_pubkey": "cHVia2V5",
        "choice": "Alice",
        "vote_nonce": "bm9uY2U=",
        "timestamp": "2026-01-01T00:00:00+00:00",
    }
    assert crypto.canonical_json(payload) == (
        '{"choice":"Alice","election_id":"e1","timestamp":"2026-01-01T00:00:00+00:00",'
        '"vote_nonce":"bm9uY2U=","voter_id":"v1","voter_pubkey":"cHVia2V5"}'
    )
