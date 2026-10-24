"""The date of birth does not leave the server.

Eligibility is a rule now, so the server has to *read* the date of birth to do
arithmetic on it. That is the whole reason it is stored in plain text instead of
the one-way fingerprint it used to be, and it is the only privacy property this
change gives up.

What must hold in exchange: the date goes into exactly one row and comes out of
nothing. Not a response body, not the audit log. This is the test that enforces
it, because "we never send it" is the kind of guarantee that decays silently as
somebody later adds a field to a payload.

The legal name, by contrast, is still hashed and still never leaves either — it
has a separate test in test_registration.py.
"""

from conftest import (
    admin as admin_admin,
    cast,
    close_window,
    enrol,
    make_election,
    register_account,
    sign_in_as,
)

# Distinctive enough that it cannot appear in a timestamp, a hash or a key.
DOB = "1993-07-19"
ACCOUNT = "asha0142"
NAME = "Asha Rao"


def test_the_date_of_birth_never_leaves_the_server(client):
    # Deliberately checked while signed in as an *admin*, the most privileged view
    # there is. If the date does not leak to the person who owns the database, it
    # does not leak.
    account_key, _public, _sealed = register_account(client, ACCOUNT, name=NAME, dob=DOB)
    make_election(client, "e1", min_age=18)
    _enrolled, _private, _public, _body = enrol(
        client, "e1", ACCOUNT, name=NAME, dob=DOB, account_key=account_key
    )
    cast(client, "e1", ACCOUNT, "Alice")
    close_window(client, "e1")
    client.post("/api/elections/e1/tally", json=admin_admin(client, "e1"))

    bodies = {
        "GET  /api/accounts/available": client.get(
            "/api/accounts/available", params={"name": NAME, "digits": "0142"}
        ).text,
        "GET  /api/accounts/{u}/sealed-key": client.get(
            f"/api/accounts/{ACCOUNT}/sealed-key"
        ).text,
        "GET  /api/auth/me": client.get("/api/auth/me").text,
        "GET  /api/me/elections": client.get("/api/me/elections").text,
        "GET  /api/elections/{id}": client.get("/api/elections/e1").text,
        "GET  /api/elections (admin)": client.get("/api/elections").text,
        "GET  /api/elections/{id}/results": client.get("/api/elections/e1/results").text,
        "GET  /api/elections/{id}/blocks": client.get("/api/elections/e1/blocks").text,
        "GET  /api/audit": client.get("/api/audit", params={"limit": 200}).text,
        "GET  /api/audit/verify": client.get("/api/audit/verify").text,
    }
    for where, body in bodies.items():
        assert DOB not in body, f"{where} returned the date of birth"

    # The year alone is enough to narrow a person down, so it must not leak
    # either — an eligibility rule of "18 and over" says nothing about which year.
    assert "1993" not in bodies["GET  /api/me/elections"]

    # And nothing wrote it to the tamper-evident log either.
    from backend.config import AUDIT_LOG_PATH

    log = AUDIT_LOG_PATH.read_bytes().decode("utf-8")
    assert DOB not in log
    assert "1993" not in log

    # And the log read above was a real one: the chain still verifies, so the
    # containment check did not pass by inspecting a corrupted or empty file.
    from backend import audit

    assert audit.verify()["valid"] is True
    assert audit.tail(200), "the log should have entries by now"


def test_the_date_of_birth_is_never_in_a_refusal_either(client):
    """The eligibility refusal is the one place where saying the applicant's age
    would be natural, and it must not."""
    make_election(client, "e1", min_age=18)
    account_key, _public, _sealed = register_account(client, "kid0142", dob="2016-04-02")
    sign_in_as(client, "kid0142", account_key)
    response, _private, _public, _body = enrol(
        client, "e1", "kid0142", dob="2016-04-02", account_key=account_key
    )
    assert response.status_code == 403
    assert "2016" not in response.text
    assert "2016-04-02" not in response.text
    assert "18" in response.text  # the rule, yes


def test_the_stored_row_is_the_only_place_it_appears(client):
    """Scans every table and column in the file. Exactly one place may hold the
    date — `accounts.dob` — so a future column that copies it fails here."""
    register_account(client, ACCOUNT, name=NAME, dob=DOB)

    from backend.database import get_connection

    tables = [
        row["name"]
        for row in get_connection().execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    ]
    all_hits: set = set()
    with get_connection() as conn:
        for table in tables:
            columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            hits = {
                (table, column)
                for row in rows
                for column in columns
                if DOB in str(row[columns.index(column)])
            }
            all_hits |= hits

    assert all_hits == {("accounts", "dob")}, f"{DOB} also found in {all_hits}"