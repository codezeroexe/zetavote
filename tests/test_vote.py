from fastapi.testclient import TestClient

from backend.app import app


client = TestClient(app)


def test_vote_submission_and_duplicate_rejection():
    client.post(
        "/api/elections",
        json={
            "id": "election_vote_001",
            "name": "Vote Test",
            "description": "Voting flow test",
            "starts_at": "2026-09-24T00:00:00Z",
            "ends_at": "2026-09-30T00:00:00Z",
        },
    )

    client.post(
        "/api/elections/election_vote_001/register",
        json={"voter_id": "voter_vote_001", "passphrase": "secure-pass"},
    )

    vote_payload = {
        "voter_id": "voter_vote_001",
        "choice": "alice",
        "vote_nonce": "nonce-001",
        "passphrase": "secure-pass",
    }

    first_vote = client.post("/api/elections/election_vote_001/vote", json=vote_payload)
    assert first_vote.status_code == 200
    first_data = first_vote.json()
    assert first_data["election_id"] == "election_vote_001"
    assert first_data["voter_id"] == "voter_vote_001"
    assert first_data["ballot_commitment"]
    assert first_data["receipt"]["ballot_commitment"] == first_data["ballot_commitment"]

    second_vote = client.post("/api/elections/election_vote_001/vote", json=vote_payload)
    assert second_vote.status_code == 400
    assert "duplicate" in second_vote.json()["detail"].lower()


def test_vote_with_wrong_passphrase_returns_401():
    """AES-GCM raises InvalidTag on a wrong key; that must surface as a
    controlled 401, not an unhandled 500."""
    client.post(
        "/api/elections",
        json={
            "id": "election_vote_002",
            "name": "Wrong Passphrase Test",
            "description": "Regression test",
            "starts_at": "2026-09-24T00:00:00Z",
            "ends_at": "2026-09-30T00:00:00Z",
        },
    )
    client.post(
        "/api/elections/election_vote_002/register",
        json={"voter_id": "voter_vote_002", "passphrase": "correct-pass"},
    )

    bad_vote = client.post(
        "/api/elections/election_vote_002/vote",
        json={
            "voter_id": "voter_vote_002",
            "choice": "alice",
            "vote_nonce": "nonce-002",
            "passphrase": "wrong-pass",
        },
    )
    assert bad_vote.status_code == 401
    assert bad_vote.json()["detail"] == "Invalid master passphrase"
