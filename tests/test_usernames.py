"""Username slugging, validation, and collision suggestions.

The account id IS the username, and it is case-sensitive in SQLite, so these
three pure functions are the only thing standing between a legal name and a
primary key. Nothing here touches the database: `taken` is passed in, which is
what makes determinism testable without a fixture.
"""

import pytest

from backend.usernames import is_valid_username, slugify, suggest


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Asha Rao", "asharao"),
        ("O'Brien,Aoife", "obrienaoife"),
        ("Anne-Marie de la Cruz", "annemariedelacruz"),
        ("José Álvarez", "josealvarez"),
    ],
)
def test_slugify_matches_the_specified_table(name, expected):
    assert slugify(name) == expected


def test_slugify_folds_letters_that_do_not_decompose():
    """ø, ł and ß carry an accent without a combining mark, so NFKD leaves
    them intact and an ascii-only filter would silently delete the name."""
    assert slugify("Øyvind Sørlø") == "oyvindsorlo"
    assert slugify("Straße") == "strasse"


def test_slugify_of_a_non_latin_name_is_empty():
    """Pins the ASCII boundary. An empty slug is not an error here — the caller
    asks the person to choose their own digits and a stem."""
    assert slugify("李雷") == ""


def test_slugify_is_idempotent():
    assert slugify(slugify("Anne-Marie de la Cruz")) == "annemariedelacruz"


@pytest.mark.parametrize("username", ["asharao0142", "a0142", "mcdonald0000", "xyzzy9999"])
def test_is_valid_username_accepts_a_slug_plus_four_digits(username):
    assert is_valid_username(username)


@pytest.mark.parametrize(
    "username",
    [
        "",
        "asharao014",  # three digits
        "0142",  # no stem
        # uppercase: the id is case-sensitive, so a mixed-case id is a
        # different account from the one the user thinks they typed
        "AshaRao0142",
        "asha rao0142",  # whitespace
        "asha-rae0142",  # punctuation
        "asharao0142 ",  # trailing whitespace
        "asharao_0142",
        "ásharao0142",  # non-ascii
    ],
)
def test_is_valid_username_rejects_anything_else(username):
    assert not is_valid_username(username)


def test_suggest_never_returns_a_taken_name():
    taken = {"asharao0142", "asharao0143", "asharao0144"}
    assert suggest("asharao0142", taken) == "asharao0145"


def test_suggest_wraps_around_and_does_not_repeat_itself():
    taken = {"asharao9999", "asharao0000", "asharao0001"}
    assert suggest("asharao9999", taken) == "asharao0002"


def test_suggest_is_deterministic():
    taken = {"asharao0142", "asharao0143"}
    first = suggest("asharao0142", taken)
    assert first == suggest("asharao0142", taken)
    assert first == suggest("asharao0142", {"asharao0143", "asharao0142"})


def test_suggestions_are_always_valid_usernames():
    taken = {"asharao0142", "asharao0143"}
    assert is_valid_username(suggest("asharao0142", taken))


def test_suggest_returns_none_when_the_suffix_space_is_exhausted():
    """All 10000 four-digit suffixes exist, so there is nothing left to offer.
    The result is None, never a taken name."""
    taken = {f"asharao{n:04d}" for n in range(10000)}
    assert suggest("asharao0142", taken) is None


def test_suggest_returns_none_for_an_invalid_base():
    assert suggest("asharao", set()) is None
