from conftest import admin, build_ballot, cast, make_election, register, resign


def test_vote_is_accepted_and_signed_by_the_voter(client):
    make_election(client)

    result = cast(client, "e1", "v1", "Alice")

    assert result["signature_valid"] is True
    assert len(result["ballot_commitment"]) == 64
    assert result["receipt"]["ballot_commitment"] == result["ballot_commitment"]


def test_duplicate_vote_rejected(client):
    make_election(client)
    election = client.get("/api/elections/e1").json()
    private_key, public_key, _ = register(client, "e1", "v1")

    first, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
    )
    assert client.post("/api/elections/e1/vote", json=first).status_code == 200

    second, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Bob",
    )
    response = client.post("/api/elections/e1/vote", json=second)
    assert response.status_code == 400
    assert "duplicate" in response.json()["detail"].lower()


def test_tampered_ciphertext_is_rejected(client):
    """The signature covers the ciphertext, so flipping a byte is caught at submit."""
    make_election(client)
    election = client.get("/api/elections/e1").json()
    private_key, public_key, _ = register(client, "e1", "v1")

    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
    )
    payload["ciphertext"] = payload["ciphertext"][:-4] + "AAAA"

    response = client.post("/api/elections/e1/vote", json=payload)
    assert response.status_code == 400
    assert "signature" in response.json()["detail"].lower()


def test_ballot_id_must_match_its_contents(client):
    make_election(client)
    election = client.get("/api/elections/e1").json()
    private_key, public_key, _ = register(client, "e1", "v1")

    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
    )
    # re-signed so the signature is valid and the ballot id is the only fault
    payload = resign({**payload, "ballot_id": "0" * 64}, private_key)

    response = client.post("/api/elections/e1/vote", json=payload)
    assert response.status_code == 400
    assert "ballot id" in response.json()["detail"].lower()


def test_public_key_must_match_registration(client):
    make_election(client)
    election = client.get("/api/elections/e1").json()
    register(client, "e1", "v1")

    from backend import crypto

    other_private, other_public = crypto.generate_ed25519_keypair()
    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=other_private,
        voter_public_key=other_public,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
    )

    response = client.post("/api/elections/e1/vote", json=payload)
    assert response.status_code == 400
    assert "public key" in response.json()["detail"].lower()


def test_my_elections_reports_enrolment_and_vote_state(client):
    """The dashboard is the one place a signed-in person learns where they stand,
    and it must read enrolments now that `voters` is gone."""
    make_election(client, "e1")
    make_election(client, "e2")
    cast(client, "e1", "v1", "Alice")

    body = client.get("/api/me/elections").json()["elections"]
    by_id = {e["id"]: e for e in body}
    assert by_id["e1"]["registered"] is True
    assert by_id["e1"]["voted"] is True
    assert by_id["e2"]["registered"] is False
    assert by_id["e2"]["voted"] is False


def test_my_elections_never_answers_for_someone_else(client):
    """`v1` has voted. `v2` must not be shown that, or the endpoint would leak
    another person's participation from a session of their own."""
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    register(client, "e1", "v2")

    body = client.get("/api/me/elections").json()["elections"]
    assert body[0]["voted"] is False


def test_my_elections_counts_enrolments(client):
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    cast(client, "e1", "v2", "Bob")
    client.post("/api/elections/e1/close", json=admin(client, "e1"))

    body = client.get("/api/me/elections").json()["elections"][0]
    assert body["counts"] == {"registered": 2, "ballots": 2, "turnout": 1.0}


def test_unenrolled_account_is_rejected(client):
    make_election(client)
    from backend import crypto

    private_key, public_key = crypto.generate_ed25519_keypair()
    election = client.get("/api/elections/e1").json()
    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="ghost",
        election_id="e1",
        choice="Alice",
    )
    response = client.post("/api/elections/e1/vote", json=payload)
    assert response.status_code == 404
    assert "enrol" in response.json()["detail"].lower()


def test_closed_election_rejects_votes(client):
    make_election(client)
    election = client.get("/api/elections/e1").json()
    # Register while the window is still open, then close, so this exercises
    # the vote path. Registering after the close is refused outright, which
    # test_windows.py covers separately.
    private_key, public_key, _ = register(client, "e1", "v1")
    assert client.post("/api/elections/e1/close", json=admin(client, "e1")).status_code == 200

    payload, _ = build_ballot(
        election_public_key=election["public_key"],
        voter_private_key=private_key,
        voter_public_key=public_key,
        voter_id="v1",
        election_id="e1",
        choice="Alice",
    )
    assert client.post("/api/elections/e1/vote", json=payload).status_code == 400
