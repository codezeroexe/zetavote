import pytest
from conftest import account_id, admin, cast, make_election, register
from test_criteria import expected_criteria_hash
from backend import merkle


def test_full_flow_to_published_results(client):
    make_election(client)
    first = cast(client, "e1", "v1", "Alice")
    cast(client, "e1", "v2", "Bob")
    cast(client, "e1", "v3", "Bob")

    verify = client.get(f"/api/elections/e1/verify/{first['ballot_commitment']}").json()
    assert verify["valid"] is True
    assert verify["checks"]["signature_valid"] is True
    assert verify["checks"]["in_audit_chain"] is True
    assert verify["checks"]["audit_chain_valid"] is True

    assert client.post("/api/elections/e1/close", json=admin(client, "e1")).status_code == 200

    tally = client.post("/api/elections/e1/tally", json=admin(client, "e1")).json()
    assert tally["total_votes"] == 3
    assert tally["choice_breakdown"] == {"Alice": 1, "Bob": 2}
    assert tally["rejected_ballots"] == 0
    assert len(tally["merkle_root"]) == 64

    published = client.get("/api/elections/e1/results").json()
    assert published["total_votes"] == 3
    assert published["choice_breakdown"] == {"Alice": 1, "Bob": 2}
    assert published["merkle_root"] == tally["merkle_root"]


def test_tally_rejects_a_ballot_carrying_an_off_list_choice(client):
    """The UI can only offer a frozen candidate list, so a ballot naming anyone
    else was built by something other than the app. Counting it would let a
    crafted request invent a phantom candidate."""
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    cast(client, "e1", "v2", "Mallory")
    client.post("/api/elections/e1/close", json=admin(client, "e1"))

    tally = client.post("/api/elections/e1/tally", json=admin(client, "e1")).json()
    assert tally["total_votes"] == 1
    assert tally["choice_breakdown"] == {"Alice": 1}
    assert tally["rejected_ballots"] == 1


def test_published_results_carry_the_eligibility_rule_and_its_hash(client):
    """Anyone can read the rule off the results and recompute the hash, which is
    what makes it a proof rather than an opaque digest."""
    make_election(client, "e1", min_age=18)
    cast(client, "e1", "v1", "Alice")
    client.post("/api/elections/e1/close", json=admin(client, "e1"))
    client.post("/api/elections/e1/tally", json=admin(client, "e1"))

    published = client.get("/api/elections/e1/results").json()
    assert published["criteria_hash"] == expected_criteria_hash(18, None)
    assert published["criteria"] == {"max_age": None, "min_age": 18}
    # The hash proves the rule; the rule itself is published so a reader can see
    # what was hashed, which nobody could do with the old roster hash.
    assert "roster_hash" not in published


def test_verify_does_not_leak_voter_identity(client):
    make_election(client)
    result = cast(client, "e1", "secret-voter", "Alice")
    body = client.get(f"/api/elections/e1/verify/{result['ballot_commitment']}").text
    # The account id, not the test handle: the handle is what the test knows the
    # person by, and asserting only on it would pass even if the real id leaked.
    assert account_id("secret-voter") not in body
    assert "voter_id" not in body


def test_verify_reports_unknown_commitment(client):
    make_election(client)
    assert client.get("/api/elections/e1/verify/" + "0" * 64).status_code == 404


def test_wrong_master_passphrase_cannot_tally(client):
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    response = client.post("/api/elections/e1/tally", json={"master_passphrase": "wrong"})
    assert response.status_code == 401


def test_ballot_sealed_to_the_election_public_key():
    """A ballot sealed to one election cannot be opened with another election's key."""
    from cryptography.exceptions import InvalidTag

    from backend import crypto

    priv_a, pub_a = crypto.generate_x25519_keypair()
    priv_b, _pub_b = crypto.generate_x25519_keypair()

    sealed = crypto.seal_with_public_key(b"secret choice", pub_a)
    assert crypto.open_with_private_key(sealed, priv_a) == b"secret choice"

    with pytest.raises(InvalidTag):
        crypto.open_with_private_key(sealed, priv_b)


def test_merkle_proof_includes_a_specific_ballot():
    leaves = [f"{i:064x}" for i in range(5)]
    root = merkle.build_root(leaves)
    for leaf in leaves:
        proof = merkle.inclusion_proof(leaves, leaf)
        assert proof is not None
        assert merkle.verify_proof(leaf, proof, root)

    stranger = "f" * 64
    assert merkle.inclusion_proof(leaves, stranger) is None
    assert not merkle.verify_proof(stranger, [], root)


def test_merkle_root_changes_when_a_ballot_is_added():
    assert merkle.build_root(["a" * 64, "b" * 64]) != merkle.build_root(["a" * 64, "b" * 64, "c" * 64])


def test_results_before_tally_is_404(client):
    make_election(client)
    assert client.get("/api/elections/e1/results").status_code == 404
