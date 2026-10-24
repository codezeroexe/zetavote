"""The audit log is the claim most likely to be tested live: 'open the file,
edit a line, see if anything notices'. These tests make sure it notices."""

from conftest import cast, make_election
from backend import audit
from backend.config import AUDIT_LOG_PATH


def test_chain_is_valid_after_normal_use(client):
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    cast(client, "e1", "v2", "Bob")

    report = audit.verify()
    assert report["valid"] is True
    assert report["broken_at"] is None
    assert report["entries"] >= 3  # create, register, vote ...


def test_every_line_carries_a_hash_and_predecessor(client):
    make_election(client)
    cast(client, "e1", "v1", "Alice")

    lines = [l for l in AUDIT_LOG_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert lines
    for line in lines:
        assert len([p for p in line.split("|")]) == 8
    assert lines[0].split("|")[6].strip() == audit.GENESIS


def test_editing_a_line_breaks_the_chain(client):
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    assert audit.verify()["valid"] is True

    lines = AUDIT_LOG_PATH.read_text(encoding="utf-8").splitlines()
    fields = lines[0].split("|")
    fields[3] = "  tampered  "
    lines[0] = "|".join(fields)
    AUDIT_LOG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    report = audit.verify()
    assert report["valid"] is False
    assert report["broken_at"] == 0


def test_deleting_a_line_breaks_the_chain(client):
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    cast(client, "e1", "v2", "Bob")

    lines = AUDIT_LOG_PATH.read_text(encoding="utf-8").splitlines()
    del lines[1]
    AUDIT_LOG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    report = audit.verify()
    assert report["valid"] is False
    assert report["broken_at"] == 1


def test_verify_endpoint_reports_chain_state(client):
    make_election(client)
    cast(client, "e1", "v1", "Alice")
    body = client.get("/api/audit/verify").json()
    assert body["valid"] is True


def test_audit_endpoint_filters_by_election(client):
    make_election(client, "e1")
    make_election(client, "e2")
    cast(client, "e1", "v1", "Alice")

    body = client.get("/api/audit", params={"election_id": "e1"}).json()
    assert body["entries"]
    assert {e["election_id"] for e in body["entries"]} == {"e1"}


def test_tampering_is_visible_through_the_verify_endpoint(client):
    make_election(client)
    result = cast(client, "e1", "v1", "Alice")

    lines = AUDIT_LOG_PATH.read_text(encoding="utf-8").splitlines()
    lines[-1] = lines[-1].replace("valid", "fraud")
    AUDIT_LOG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    body = client.get(f"/api/elections/e1/verify/{result['ballot_commitment']}").json()
    assert body["valid"] is False
    assert body["checks"]["audit_chain_valid"] is False
