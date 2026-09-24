from fastapi.testclient import TestClient

from backend.app import app


client = TestClient(app)


def test_create_election_and_register_voter():
    election_resp = client.post(
        "/api/elections",
        json={
            "id": "election_001",
            "name": "Test Election",
            "description": "Basic registration test",
            "starts_at": "2026-09-24T00:00:00Z",
            "ends_at": "2026-09-30T00:00:00Z",
        },
    )
    assert election_resp.status_code == 200

    register_resp = client.post(
        "/api/elections/election_001/register",
        json={"voter_id": "voter_001", "passphrase": "secure-pass"},
    )

    assert register_resp.status_code == 200
    payload = register_resp.json()
    assert payload["election_id"] == "election_001"
    assert payload["voter_id"] == "voter_001"
    assert "receipt" in payload
    assert payload["receipt"]["voter_id_hash"]
