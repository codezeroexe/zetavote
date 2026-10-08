"""The voting window was previously stored and never enforced."""

from datetime import datetime, timedelta, timezone

from conftest import as_admin, build_ballot, cast, close_window, make_election, register


def iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def vote(client, election_id: str, voter_id: str):
    election = client.get(f"/api/elections/{election_id}").json()
    private_key, public_key, _ = register(client, election_id, voter_id)
    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id=voter_id,
        election_id=election_id,
        choice="Alice",
    )
    return client.post(f"/api/elections/{election_id}/vote", json=payload)


def test_vote_before_window_opens_is_rejected(client):
    make_election(client, starts_at=iso(timedelta(hours=2)), ends_at=iso(timedelta(hours=3)))
    # Registration is allowed ahead of the start; the ballot still cannot be
    # cast until the window opens.
    response = vote(client, "e1", "v1")
    assert response.status_code == 400
    assert "not opened" in response.json()["detail"].lower()


def test_vote_after_window_closes_is_rejected(client):
    make_election(client)
    # Register while the window is still open, then let it close. Creating the
    # election already-closed cannot work: registration is shut once the window
    # closes, so the ballot would never exist.
    election = client.get("/api/elections/e1").json()
    private_key, public_key, _ = register(client, "e1", "v1")
    close_window(client, "e1")
    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
    )
    response = client.post("/api/elections/e1/vote", json=payload)
    assert response.status_code == 400
    assert "closed" in response.json()["detail"].lower()


def test_vote_inside_window_is_accepted(client):
    make_election(client, starts_at=iso(timedelta(hours=-1)), ends_at=iso(timedelta(hours=1)))
    assert vote(client, "e1", "v1").status_code == 200


def test_expired_window_marks_the_election_not_accepting(client):
    make_election(client, starts_at=iso(timedelta(hours=-3)), ends_at=iso(timedelta(hours=-2)))
    detail = client.get("/api/elections/e1").json()
    assert detail["accepting_votes"] is False


def test_list_elections_reports_turnout(client):
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    cast(client, "e1", "v2", "Bob")
    as_admin(client)  # the casts left the session signed in as v2
    elections = client.get("/api/elections").json()["elections"]
    assert elections[0]["registered"] == 2
    assert elections[0]["ballots"] == 2
    assert elections[0]["turnout"] == 1.0
