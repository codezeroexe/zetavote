"""Enrolment: joining an election because you meet its rule.

The roster that used to be here is gone. What replaces it is a boundary: someone
eligible the day before their birthday is not eligible today, and someone who is
exactly old enough is. Everything else is the same request it always was — a
ballot key the browser minted, signed with the account key.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from conftest import close_window, enrol, make_election, make_voter_keys, register_account

TODAY = date.today()


def born(years_ago: int) -> str:
    """A birthdate that makes someone exactly `years_ago` years old today."""
    return date(TODAY.year - years_ago, TODAY.month, TODAY.day).isoformat()


ADULT = born(30)
MINOR = born(10)


# --------------------------------------------------------------------------
# The rule
# --------------------------------------------------------------------------


def test_an_eligible_account_enrols(client):
    make_election(client, "e1", min_age=18)
    response, _private, _public, _body = enrol(client, "e1", "asha0142", dob=ADULT)
    assert response.status_code == 201, response.text
    assert response.json()["username"] == "asha0142"


def test_an_under_age_account_is_refused_with_the_rule(client):
    """The message states the rule, never the applicant's age — otherwise the
    response becomes a way to confirm a birthdate the server now holds."""
    make_election(client, "e1", min_age=18)
    response, _private, _public, _body = enrol(client, "e1", "kid0142", dob=MINOR)
    assert response.status_code == 403
    detail = response.json()["detail"].lower()
    assert "18" in detail and "over" in detail
    assert MINOR not in detail


def test_an_over_age_account_is_refused_against_a_ceiling(client):
    make_election(client, "e1", min_age=None, max_age=25)
    response, _private, _public, _body = enrol(client, "e1", "old0142", dob=born(40))
    assert response.status_code == 403
    assert "25" in response.json()["detail"]


def test_exactly_the_minimum_age_is_eligible(client):
    """Their eighteenth birthday is today. An off-by-one here reads as "19 and
    over", and nobody is ever told why the rule rejected them."""
    make_election(client, "e1", min_age=18)
    response, _private, _public, _body = enrol(client, "e1", "edge0142", dob=born(18))
    assert response.status_code == 201, response.text


# The day *before* the birthday is covered in tests/test_eligibility.py, which can
# pass a fixed `today`. Over HTTP the endpoint reads the server's clock, and adding
# a seam to production code so a test can move the clock is not worth it: what the
# endpoint could plausibly get wrong is the inclusive boundary, tested above.


def test_no_bounds_admits_anyone(client):
    make_election(client, "e1")
    for username, dob in [("old0142", born(70)), ("kid0142", MINOR)]:
        response, _private, _public, _body = enrol(client, "e1", username, dob=dob)
        assert response.status_code == 201, (username, response.text)


def test_two_accounts_sharing_a_birthdate_both_enrol(client):
    """Twins, or two people who happen to share one. No uniqueness constraint may
    creep back in on the date — the roster line was what stopped duplicates, and
    there is no roster now, so this test is the guard."""
    make_election(client, "e1", min_age=18)
    first, _private, _public, _body = enrol(client, "e1", "twin0142", dob=ADULT)
    second, _private, _public, _body = enrol(client, "e1", "twin0143", dob=ADULT)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text


def test_enrolling_twice_is_refused(client):
    make_election(client, "e1", min_age=18)
    account_key, _public, _sealed = register_account(client, "asha0142", dob=ADULT)
    first, _private, _public, _body = enrol(client, "e1", "asha0142", dob=ADULT, account_key=account_key)
    assert first.status_code == 201, first.text
    again, _private, _public, _body = enrol(client, "e1", "asha0142", dob=ADULT, account_key=account_key)
    assert again.status_code == 409


# --------------------------------------------------------------------------
# The request must still come from the keyholder
# --------------------------------------------------------------------------


def test_enrolment_requires_a_session(client):
    make_election(client, "e1", min_age=18)
    account_key, _public, _sealed = register_account(client, "asha0142", dob=ADULT)
    client.post("/api/auth/logout")
    response, _private, _public, _body = enrol(
        client, "e1", "asha0142", dob=ADULT, account_key=account_key, sign_in=False
    )
    assert response.status_code == 401


def test_enrolment_signed_with_the_wrong_key_is_refused(client):
    """A stolen session cookie must not be enough: the attacker would supply a
    ballot key whose private half only they hold."""
    make_election(client, "e1", min_age=18)
    impostor_key, _public, _sealed = make_voter_keys("impostor-pass")
    response, _private, _public, _body = enrol(
        client, "e1", "asha0142", dob=ADULT, sign_with=impostor_key
    )
    assert response.status_code == 401


def test_a_replayed_challenge_is_refused(client):
    make_election(client, "e1", min_age=18)
    _response, _private, _public, body = enrol(client, "e1", "asha0142", dob=ADULT)
    assert client.post("/api/elections/e1/enrol", json=body).status_code == 401


def test_the_challenge_is_burned_even_when_ineligible(client):
    """The signature is checked first, so a probe cannot consume challenges and
    then learn nothing."""
    make_election(client, "e1", min_age=18)
    response, _private, _public, body = enrol(client, "e1", "kid0142", dob=MINOR)
    assert response.status_code == 403
    replay = client.post("/api/elections/e1/enrol", json=body)
    assert replay.status_code == 401


# --------------------------------------------------------------------------
# Keys
# --------------------------------------------------------------------------


def test_the_sealed_ballot_key_is_the_private_half_of_the_announced_key(client):
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from backend.crypto import b64, decrypt_bytes, scrypt_derive, unb64

    make_election(client, "e1", min_age=18)
    _response, _private, ballot_public, body = enrol(client, "e1", "asha0142", dob=ADULT)
    sealed = body["sealed_ballot_key"]

    key = scrypt_derive("ballot-pass", unb64(sealed["salt"]), n=2**12)
    recovered = Ed25519PrivateKey.from_private_bytes(decrypt_bytes(sealed, key))
    assert b64(recovered.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )) == ballot_public

    wrong = scrypt_derive("not-the-passphrase", unb64(sealed["salt"]), n=2**12)
    with pytest.raises(InvalidTag):
        decrypt_bytes(sealed, wrong)


def test_the_ballot_key_is_minted_fresh_per_election(client):
    """Not reused from the account: a key appearing in two elections would let
    anyone holding the audit log link them."""
    make_election(client, "e1", min_age=18)
    make_election(client, "e2", min_age=18)

    account_key, account_public, _sealed = register_account(client, "asha0142", dob=ADULT)
    _first, first_key, _s1, _b1 = enrol(client, "e1", "asha0142", dob=ADULT, account_key=account_key)
    _second, second_key, _s2, _b2 = enrol(client, "e2", "asha0142", dob=ADULT, account_key=account_key)

    assert first_key != second_key
    assert first_key != account_public and second_key != account_public


# --------------------------------------------------------------------------
# Windows
# --------------------------------------------------------------------------


def test_enrolling_before_the_window_opens_is_allowed(client):
    starts = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    make_election(client, "e1", min_age=18, starts_at=starts)
    response, _private, _public, _body = enrol(client, "e1", "asha0142", dob=ADULT)
    assert response.status_code == 201, response.text


def test_enrolment_is_refused_once_the_window_closes(client):
    make_election(client, "e1", min_age=18)
    close_window(client, "e1")
    response, _private, _public, _body = enrol(client, "e1", "asha0142", dob=ADULT)
    assert response.status_code == 400
    assert "closed" in response.json()["detail"].lower()


def test_the_eligibility_rule_is_not_editable_through_the_api(client):
    make_election(client, "e1", min_age=18)
    response = client.put("/api/elections/e1", json={"min_age": 0})
    assert response.status_code in (404, 405)


# --------------------------------------------------------------------------
# The dashboard knows whether this account may join
# --------------------------------------------------------------------------


def test_my_elections_reports_eligibility(client):
    make_election(client, "e1", min_age=18)
    make_election(client, "e2", max_age=25)
    enrol(client, "e1", "asha0142", dob=ADULT)

    body = client.get("/api/me/elections").json()["elections"]
    by_id = {e["id"]: e for e in body}
    assert by_id["e1"]["eligible"] is True
    assert by_id["e1"]["registered"] is True
    assert by_id["e2"]["eligible"] is False


def test_an_ineligible_account_is_told_so_rather_than_offered_a_join_that_cannot_work(client):
    make_election(client, "e1", min_age=18)
    enrol(client, "e1", "kid0142", dob=MINOR)
    row = client.get("/api/me/elections").json()["elections"][0]
    assert row["eligible"] is False
    assert row["registered"] is False
