import uuid

from fastapi.testclient import TestClient

from backend.app import app


client = TestClient(app)


def test_verification_and_tally_flow():
    election_id = f"election_verify_{uuid.uuid4().hex[:8]}"
    election_resp = client.post(
        "/api/elections",
        json={
            "id": election_id,
            "name": "Verification Election",
            "description": "Verify and tally flow",
            "starts_at": "2026-09-24T00:00:00Z",
            "ends_at": "2026-09-30T00:00:00Z",
            "master_passphrase": "master-pass",
        },
    )
    assert election_resp.status_code == 200

    reg_resp = client.post(
        f"/api/elections/{election_id}/register",
        json={"voter_id": "voter_verify_001", "passphrase": "secure-pass"},
    )
    assert reg_resp.status_code == 200

    vote_resp = client.post(
        f"/api/elections/{election_id}/vote",
        json={
            "voter_id": "voter_verify_001",
            "choice": "alice",
            "vote_nonce": "nonce-verify",
            "passphrase": "secure-pass",
        },
    )
    assert vote_resp.status_code == 200
    commitment = vote_resp.json()["ballot_commitment"]

    verify_resp = client.get(f"/api/elections/{election_id}/verify/{commitment}")
    assert verify_resp.status_code == 200
    assert verify_resp.json()["valid"] is True

    close_resp = client.post(
        f"/api/elections/{election_id}/close",
        json={"master_passphrase": "master-pass"},
    )
    assert close_resp.status_code == 200
    assert close_resp.json()["status"] == "closed"

    tally_resp = client.post(
        f"/api/elections/{election_id}/tally",
        json={"master_passphrase": "master-pass"},
    )
    assert tally_resp.status_code == 200
    result = tally_resp.json()
    assert result["total_votes"] == 1
    assert result["choice_breakdown"]["alice"] == 1
