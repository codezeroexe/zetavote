"""An account is global and for life. The browser generates and seals the account
key; the server never sees a passphrase and never holds an unsealed private key.

Registration is not per-election, so most of this file has nothing to do with
elections. The two registration-window tests that used to live here moved to
enrolment in Stage 4, where a window exists to be shut by.
"""

import json

from conftest import make_voter_keys

IDENTITY = {"name": "Asha Rao", "dob": "1996-03-12"}


def create_account(client, username="asharao0142", **overrides):
    private_key, public_key, sealed = make_voter_keys("account-pass")
    body = {
        **IDENTITY,
        "username": username,
        "public_key": public_key,
        "sealed_key": sealed,
        **overrides,
    }
    return client.post("/api/accounts", json=body), private_key, public_key, sealed


# --------------------------------------------------------------------------
# Creation
# --------------------------------------------------------------------------


def test_creating_an_account_needs_no_election_and_no_session(anonymous_client):
    response, _private, _public, _sealed = create_account(anonymous_client)
    assert response.status_code == 201, response.text
    assert response.json()["username"] == "asharao0142"


def test_the_account_id_is_the_username(client):
    create_account(client)
    from backend.database import get_connection

    with get_connection() as conn:
        row = conn.execute("SELECT * FROM accounts").fetchone()
    assert row["id"] == "asharao0142"


def test_registration_stores_sealed_key_not_a_passphrase(client):
    response, _private, _public, sealed = create_account(client)
    assert response.status_code == 201
    assert "account-pass" not in response.text

    from backend.database import get_connection

    with get_connection() as conn:
        row = conn.execute("SELECT * FROM accounts").fetchone()
    # the sealed blob is stored verbatim, and the plaintext private key is not
    assert json.loads(row["sealed_key"])["ciphertext"] == sealed["ciphertext"]


def test_the_legal_name_is_never_stored(client):
    """The name stays a one-way fingerprint, because nothing needs to read it.
    The date of birth does need to be read — eligibility is a rule now — so it is
    stored plainly, and what keeps *it* contained is the escape test."""
    create_account(client)

    from backend.database import get_connection

    with get_connection() as conn:
        row = conn.execute("SELECT * FROM accounts").fetchone()
        everything = "".join(str(v) for v in tuple(row))
    assert row["name_hash"]
    assert "Asha" not in everything and "Rao" not in everything


def test_the_date_of_birth_is_stored_readable(client):
    """Stated rather than left implicit, because it is a real change: the server
    has to do arithmetic on this value to answer whether someone is eligible."""
    create_account(client)

    from backend.database import get_connection

    with get_connection() as conn:
        row = conn.execute("SELECT dob FROM accounts").fetchone()
    assert row["dob"] == "1996-03-12"


def test_name_and_dob_are_normalised_before_fingerprinting(client):
    """Accents, case and spacing must not fork one person into two fingerprints,
    or the duplicate-account warning misses both spellings."""
    create_account(client, username="josealvarez0142", name="José Álvarez", dob="1996-03-12")
    create_account(client, username="josealvarez0000", name="  jose  ALVAREZ  ", dob="1996-03-12")

    from backend.database import get_connection

    with get_connection() as conn:
        rows = conn.execute("SELECT name_hash FROM accounts").fetchall()
    assert rows[0]["name_hash"] == rows[1]["name_hash"]


def test_two_people_may_share_a_birthdate_without_being_confused(client):
    """Shared by design and harmless now: the duplicate warning compares the pair
    of name and birthdate, and no uniqueness constraint sits on either."""
    create_account(client, username="asharao0142", name="Asha Rao", dob="1996-03-12")
    create_account(client, username="raman0142", name="Raman", dob="1996-03-12")

    from backend.database import get_connection

    with get_connection() as conn:
        rows = conn.execute("SELECT name_hash, dob FROM accounts ORDER BY id").fetchall()
    assert rows[0]["name_hash"] != rows[1]["name_hash"]
    assert rows[0]["dob"] == rows[1]["dob"]


# --------------------------------------------------------------------------
# Username collisions — suggest, never refuse
# --------------------------------------------------------------------------


def test_a_taken_username_is_refused_with_suggestions(client):
    response, _private, _public, _sealed = create_account(client)
    assert response.status_code == 201
    assert response.json()["suggestions"] == []

    taken, _private, _public, _sealed = create_account(client, name="Different Person")
    assert taken.status_code == 409
    suggestions = taken.json()["suggestions"]
    assert suggestions
    assert "asharao0142" not in suggestions


def test_every_offered_suggestion_is_actually_free(client):
    create_account(client)
    taken, _private, _public, _sealed = create_account(client, name="Different Person")
    for candidate in taken.json()["suggestions"]:
        response, _private, _public, _sealed = create_account(client, username=candidate)
        assert response.status_code == 201, (candidate, response.text)


def test_suggestions_are_deterministic(client):
    create_account(client)
    first, _private, _public, _sealed = create_account(client, name="Different Person")
    second, _private, _public, _sealed = create_account(client, name="Different Person")
    assert first.json()["suggestions"] == second.json()["suggestions"]


def test_a_malformed_username_is_refused(client):
    for bad in ["", "AshaRao0142", "asharao014", "asharao0142!", "0142"]:
        response, _private, _public, _sealed = create_account(client, username=bad)
        assert response.status_code in (400, 422), (bad, response.text)


# --------------------------------------------------------------------------
# Availability
# --------------------------------------------------------------------------


def test_available_reports_a_free_name(anonymous_client):
    response = anonymous_client.get(
        "/api/accounts/available", params={"name": "Asha Rao", "digits": "0142"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "asharao0142"
    assert body["available"] is True
    assert body["suggestions"] == []


def test_available_reports_a_taken_name_with_alternatives(client):
    create_account(client)
    body = client.get("/api/accounts/available", params={"name": "Asha Rao", "digits": "0142"}).json()
    assert body["available"] is False
    assert body["suggestions"]
    assert "asharao0142" not in body["suggestions"]


def test_available_says_nothing_is_available_for_a_name_it_cannot_slug(anonymous_client):
    """A name in a script it cannot transliterate slugs to nothing, and offering
    '0142' as a username would be worse than saying so."""
    body = anonymous_client.get("/api/accounts/available", params={"name": "李雷", "digits": "0142"}).json()
    assert body["username"] == ""
    assert body["available"] is False
    assert body["suggestions"] == []


# --------------------------------------------------------------------------
# Duplicate warning
# --------------------------------------------------------------------------


def test_matching_name_and_dob_warns_but_does_not_block(client):
    """A hard block would lock out twins and stop nobody who shifted their dob
    by a day, so a repeat identity only produces a warning."""
    first, _private, _public, _sealed = create_account(client)
    assert first.json()["warning"] is None

    second, _private, _public, _sealed = create_account(client, username="asharao0143")
    # Allowed, because two people genuinely can share a name and birth date.
    assert second.status_code == 201, second.text
    assert second.json()["warning"]


def test_a_different_name_with_the_same_dob_does_not_warn(client):
    create_account(client, name="Asha Rao")
    second, _private, _public, _sealed = create_account(client, username="raman0142", name="Raman")
    assert second.json()["warning"] is None


# --------------------------------------------------------------------------
# Sealed key retrieval — how a second device signs in
# --------------------------------------------------------------------------


def test_the_sealed_key_is_fetchable_for_signing_in_elsewhere(client):
    create_account(client)
    response = client.get("/api/accounts/asharao0142/sealed-key")
    assert response.status_code == 200
    assert set(response.json()["sealed_key"]) == {"salt", "nonce", "ciphertext"}


def test_fetching_a_sealed_key_for_an_unknown_account_is_404(client):
    assert client.get("/api/accounts/nobody0142/sealed-key").status_code == 404


# --------------------------------------------------------------------------
# Unrelated to accounts, but filed here
# --------------------------------------------------------------------------


def test_master_passphrase_is_never_stored(client):
    client.post(
        "/api/elections",
        json={
            "id": "e1",
            "name": "E1",
            "master_passphrase": "master-passphrase",
            "candidates": ["Alice"],
        },
    )
    from backend.database import get_connection

    with get_connection() as conn:
        row = conn.execute("SELECT * FROM elections WHERE id = 'e1'").fetchone()

    columns = row.keys()
    assert "master_passphrase" not in columns
    assert "master-passphrase" not in "".join(str(v) for v in tuple(row))
