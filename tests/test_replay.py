"""Replay protection. The old scheme only checked 'has this voter already
voted', so a captured request replayed before that check landed was possible,
and nothing tied a ballot to the moment it was made."""

from datetime import datetime, timedelta, timezone

from conftest import build_ballot, make_election, register


def iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def prepared(client, election_id="e1", voter_id="v1"):
    election = client.get(f"/api/elections/{election_id}").json()
    private_key, public_key, _ = register(client, election_id, voter_id)
    return election, private_key, public_key


def test_stale_timestamp_is_rejected(client):
    make_election(client)
    election, private_key, public_key = prepared(client)

    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
        timestamp=iso(timedelta(minutes=-30)),
    )
    response = client.post("/api/elections/e1/vote", json=payload)
    assert response.status_code == 400
    assert "window" in response.json()["detail"].lower()


def test_future_timestamp_is_rejected(client):
    make_election(client)
    election, private_key, public_key = prepared(client)

    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
        timestamp=iso(timedelta(minutes=30)),
    )
    assert client.post("/api/elections/e1/vote", json=payload).status_code == 400


def test_replaying_a_captured_request_is_rejected(client):
    make_election(client)
    election, private_key, public_key = prepared(client)

    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
    )
    assert client.post("/api/elections/e1/vote", json=payload).status_code == 200
    # identical request, second time
    assert client.post("/api/elections/e1/vote", json=payload).status_code == 400


def test_reusing_a_nonce_with_a_different_choice_still_collides(client):
    """ballot_id deliberately excludes the choice, so this hits the primary key."""
    make_election(client)
    election, private_key, public_key = prepared(client)
    nonce = "fixed-nonce-for-this-test"

    first, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
        vote_nonce=nonce,
    )
    assert client.post("/api/elections/e1/vote", json=first).status_code == 200

    second, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Bob",
        vote_nonce=nonce,
    )
    assert second["ballot_id"] == first["ballot_id"]
    assert client.post("/api/elections/e1/vote", json=second).status_code == 400


def test_malformed_timestamp_is_rejected(client):
    make_election(client)
    election, private_key, public_key = prepared(client)
    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
        timestamp="not-a-timestamp",
    )
    assert client.post("/api/elections/e1/vote", json=payload).status_code == 400
