"""Who is eligible to vote in an election, stated as a rule.

Replaces the roster an admin used to upload. Two things are worth testing that a
plain bounds check would miss: the bounds must be inclusive at both ends, and an
absurd bound is a typo rather than a policy.
"""

from conftest import make_election
from backend.crypto import canonical_json, sha256_hex


def expected_criteria_hash(min_age, max_age):
    """Recomputed here rather than by calling the server's helper, so this checks
    the published format and not merely that the function is idempotent."""
    return sha256_hex(canonical_json({"max_age": max_age, "min_age": min_age}))


# --------------------------------------------------------------------------
# The rule's four shapes
# --------------------------------------------------------------------------


def test_an_election_with_no_age_bounds_admits_everyone(client):
    body = make_election(client).copy()
    assert make_election(client, "e2").get("criteria") == {"max_age": None, "min_age": None}


def test_a_minimum_alone(client):
    assert make_election(client, "e1", min_age=18)["criteria"] == {"max_age": None, "min_age": 18}


def test_a_maximum_alone(client):
    assert make_election(client, "e1", max_age=25)["criteria"] == {"max_age": 25, "min_age": None}


def test_a_band(client):
    assert make_election(client, "e1", min_age=18, max_age=25)["criteria"] == {
        "max_age": 25,
        "min_age": 18,
    }


# --------------------------------------------------------------------------
# The stored proof
# --------------------------------------------------------------------------


def test_the_criteria_hash_is_stored_at_creation(client):
    make_election(client, "e1", min_age=18)
    from backend.database import get_connection

    with get_connection() as conn:
        stored = conn.execute(
            "SELECT criteria_hash, min_age, max_age FROM elections WHERE id = 'e1'"
        ).fetchone()
    assert stored["min_age"] == 18
    assert stored["max_age"] is None
    assert stored["criteria_hash"] == expected_criteria_hash(18, None)


def test_two_elections_with_the_same_rule_publish_the_same_hash(client):
    make_election(client, "e1", min_age=18)
    make_election(client, "e2", min_age=18)
    from backend.database import get_connection

    with get_connection() as conn:
        hashes = {
            row["id"]: row["criteria_hash"]
            for row in conn.execute("SELECT id, criteria_hash FROM elections")
        }
    assert hashes["e1"] == hashes["e2"]


def test_a_different_rule_publishes_a_different_hash(client):
    make_election(client, "e1", min_age=18)
    make_election(client, "e2", min_age=19)
    from backend.database import get_connection

    with get_connection() as conn:
        hashes = {
            row["id"]: row["criteria_hash"]
            for row in conn.execute("SELECT id, criteria_hash FROM elections")
        }
    assert hashes["e1"] != hashes["e2"]


# --------------------------------------------------------------------------
# Nonsense bounds are rejected at creation, not discovered at enrolment
# --------------------------------------------------------------------------


def create_raw(client, **overrides):
    from conftest import ADMIN_NAME, MASTER

    body = {
        "id": overrides.pop("id", "e1"),
        "name": "E1",
        "master_passphrase": MASTER,
        "candidates": ["Alice"],
        **overrides,
    }
    return client.post("/api/elections", json=body)


def test_a_negative_minimum_is_refused(client):
    assert create_raw(client, min_age=-1).status_code == 422


def test_a_negative_maximum_is_refused(client):
    assert create_raw(client, max_age=-5).status_code == 422


def test_an_impossible_band_is_refused(client):
    response = create_raw(client, min_age=30, max_age=18)
    assert response.status_code == 400
    assert "max" in response.json()["detail"].lower()


def test_an_absurd_bound_is_refused(client):
    """Nobody is 9000. A bound that large is a typo, and accepting it would
    silently produce an election nobody can ever join."""
    assert create_raw(client, min_age=9000).status_code == 422


def test_a_boundary_bound_is_accepted(client):
    assert create_raw(client, id="e1", min_age=0).status_code == 200
    assert create_raw(client, id="e2", min_age=150).status_code == 200


def test_no_lower_bound_and_a_zero_lower_bound_hash_differently(client):
    """A decision, pinned: they mean the same thing, but the hash covers the rule
    as the admin stated it, because that is the thing being attested. Publishing
    one hash for "0 and over" and another for "blank" would be describing the
    form rather than the rule."""
    make_election(client, "e1")
    make_election(client, "e2", min_age=0)
    from backend.database import get_connection

    with get_connection() as conn:
        hashes = {
            row["id"]: row["criteria_hash"]
            for row in conn.execute("SELECT id, criteria_hash FROM elections")
        }
    assert hashes["e1"] != hashes["e2"]
    assert hashes["e1"] == expected_criteria_hash(None, None)
    assert hashes["e2"] == expected_criteria_hash(0, None)


def test_the_rule_cannot_be_edited_after_creation(client):
    """Fixed at creation, like the candidate list: an eligibility rule that could
    be widened mid-vote would be indistinguishable from manipulation."""
    make_election(client, "e1", min_age=18)
    from backend.database import get_connection

    with get_connection() as conn:
        conn.execute("UPDATE elections SET min_age = 0 WHERE id = 'e1'")
        conn.commit()
        # Nothing recomputes the hash, so a hand-edited rule no longer matches it.
        row = conn.execute(
            "SELECT min_age, criteria_hash FROM elections WHERE id = 'e1'"
        ).fetchone()
    assert row["min_age"] == 0
    assert row["criteria_hash"] == expected_criteria_hash(18, None)