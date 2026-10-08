"""The admin's deny-list.

What it is: a per-election list of accounts the admin has barred. What it is
not, and this file is as much about that as about the endpoints — nothing here
stops one person making a second account. The roster line that used to do that
is gone, so a duplicate can simply register again and vote again. A block acts on
a duplicate an admin has already found, and that is genuinely all an admin can do
without verifying identity against something outside this app.
"""

from conftest import admin, as_admin, cast, enrol, make_election, register_account

BLOCKED = "trouble0142"
OTHER = "asha0142"


def enrol_as(client, election_id, username):
    account_key, _public, _sealed = register_account(client, username)
    return enrol(client, election_id, username, account_key=account_key)


# --------------------------------------------------------------------------
# It stops a blocked account, and only that account
# --------------------------------------------------------------------------


def test_a_blocked_account_cannot_enrol(client):
    make_election(client, "e1", min_age=18)
    account_key, _public, _sealed = register_account(client, BLOCKED)

    added = as_admin(client).post(
        "/api/elections/e1/blocks", json={"username": BLOCKED, "reason": "second account"}
    )
    assert added.status_code == 201, added.text

    response, _private, _public, _body = enrol(client, "e1", BLOCKED, account_key=account_key)
    assert response.status_code == 403
    assert "blocked" in response.json()["detail"].lower()


def test_the_legitimate_account_still_works(client):
    """A block names one account. Blocking a duplicate must not lock out the
    original, nor a twin who shares the birthdate."""
    make_election(client, "e1", min_age=18)
    as_admin(client).post("/api/elections/e1/blocks", json={"username": BLOCKED})
    response, _private, _public, _body = enrol_as(client, "e1", OTHER)
    assert response.status_code == 201, response.text


def test_removing_a_block_restores_access(client):
    make_election(client, "e1", min_age=18)
    admin_client = as_admin(client)
    admin_client.post("/api/elections/e1/blocks", json={"username": BLOCKED})

    account_key, _public, _sealed = register_account(client, BLOCKED)
    denied, _private, _public, _body = enrol(client, "e1", BLOCKED, account_key=account_key)
    assert denied.status_code == 403

    removed = as_admin(client).delete(f"/api/elections/e1/blocks/{BLOCKED}")
    assert removed.status_code == 200
    allowed, _private, _public, _body = enrol(client, "e1", BLOCKED, account_key=account_key)
    assert allowed.status_code == 201, allowed.text


def test_a_block_may_name_an_account_that_does_not_exist_yet(client):
    """Which is how a known duplicate is stopped before its third attempt."""
    make_election(client, "e1", min_age=18)
    added = as_admin(client).post(
        "/api/elections/e1/blocks", json={"username": "notyet0142", "reason": "watching this one"}
    )
    assert added.status_code == 201
    listed = as_admin(client).get("/api/elections/e1/blocks").json()["blocks"]
    assert listed[0]["username"] == "notyet0142"
    assert listed[0]["reason"] == "watching this one"


def test_a_block_does_not_retract_a_ballot_that_was_already_cast(client):
    """Blocking governs joining, not counting. Withdrawing a ballot after the fact
    is the manipulation this app exists to make impossible, so a block never
    reaches backwards."""
    make_election(client, "e1", min_age=18)
    account_key, _public, _sealed = register_account(client, BLOCKED)
    joined, _private, _public, _body = enrol(client, "e1", BLOCKED, account_key=account_key)
    assert joined.status_code == 201, joined.text

    as_admin(client).post("/api/elections/e1/blocks", json={"username": BLOCKED})
    voted = cast(client, "e1", BLOCKED, "Alice")
    assert voted["signature_valid"] is True


def test_a_block_is_scoped_to_one_election(client):
    """Barred from the election with the problem, not from the app."""
    make_election(client, "e1", min_age=18)
    make_election(client, "e2", min_age=18)
    as_admin(client).post("/api/elections/e1/blocks", json={"username": BLOCKED})
    elsewhere, _private, _public, _body = enrol_as(client, "e2", BLOCKED)
    assert elsewhere.status_code == 201, elsewhere.text


# --------------------------------------------------------------------------
# Admin-only
# --------------------------------------------------------------------------


def test_the_endpoints_require_an_admin(client, anonymous_client):
    """Election created as an admin, then every call made with no session at all."""
    make_election(client, "e1", min_age=18)
    assert anonymous_client.get("/api/elections/e1/blocks").status_code == 401
    assert anonymous_client.post(
        "/api/elections/e1/blocks", json={"username": BLOCKED}
    ).status_code == 401
    assert anonymous_client.delete(f"/api/elections/e1/blocks/{BLOCKED}").status_code == 401


def test_a_voter_cannot_manage_the_list(client):
    make_election(client, "e1", min_age=18)
    enrol_as(client, "e1", OTHER)
    assert client.get("/api/elections/e1/blocks").status_code == 403
    assert client.post("/api/elections/e1/blocks", json={"username": OTHER}).status_code == 403
    assert client.delete(f"/api/elections/e1/blocks/{OTHER}").status_code == 403


def test_adding_the_same_account_twice_is_not_an_error(client):
    """Idempotent: an admin clicking twice should not get an error dialog."""
    make_election(client, "e1", min_age=18)
    admin_client = as_admin(client)
    assert admin_client.post("/api/elections/e1/blocks", json={"username": BLOCKED}).status_code == 201
    assert admin_client.post("/api/elections/e1/blocks", json={"username": BLOCKED}).status_code == 200
    assert len(admin_client.get("/api/elections/e1/blocks").json()["blocks"]) == 1


def test_removing_an_account_that_is_not_blocked_is_a_404(client):
    make_election(client, "e1", min_age=18)
    assert as_admin(client).delete("/api/elections/e1/blocks/nobody0142").status_code == 404


def test_the_list_is_empty_to_begin_with(client):
    make_election(client, "e1", min_age=18)
    assert as_admin(client).get("/api/elections/e1/blocks").json() == {"blocks": []}


def test_blocking_is_audited(client):
    """A deny-list that nobody can see is how a disenfranchisement becomes
    invisible."""
    make_election(client, "e1", min_age=18)
    as_admin(client).post("/api/elections/e1/blocks", json={"username": BLOCKED})
    actions = [entry["action"] for entry in client.get("/api/audit?limit=200").json()["entries"]]
    assert "block-account" in actions


def test_the_master_passphrase_is_not_needed_to_block(client):
    """The block list is a moderation tool, not part of the election's
    cryptographic state, so it does not need the election key."""
    make_election(client, "e1", min_age=18)
    added = as_admin(client).post("/api/elections/e1/blocks", json={"username": BLOCKED})
    assert added.status_code == 201
    assert admin(client, "e1") == {"master_passphrase": "master-passphrase"}