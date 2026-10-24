from fastapi.testclient import TestClient


def test_security_headers_present(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "no-referrer"


def test_ballots_are_never_stored_in_plaintext(client):
    """The whole point: the DB must not contain the choice in the clear."""
    from conftest import cast, make_election
    from backend.database import get_connection

    make_election(client)
    result = cast(client, "e1", "v1", "Alice")

    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM ballots").fetchall()

    assert rows
    for row in rows:
        blob = "".join(str(v) for v in tuple(row))
        assert "Alice" not in blob
    assert result["ballot_commitment"] not in "".join(str(r["ciphertext"]) for r in rows)


def test_master_passphrase_absent_from_the_database_file(client):
    from conftest import make_election
    from backend.config import DB_PATH

    make_election(client, master="a-very-recognisable-passphrase")
    assert b"a-very-recognisable-passphrase" not in DB_PATH.read_bytes()
