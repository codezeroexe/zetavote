"""The age rule. Pure, with the date injected, so every boundary is a test rather
than a coincidence of when the suite runs."""

from datetime import date

import pytest

from backend.eligibility import age_on, criteria_hash, describe, meets_criteria

TODAY = date(2026, 10, 1)


# --------------------------------------------------------------------------
# The case that a year-based comparison gets wrong
# --------------------------------------------------------------------------


def test_someone_is_not_eligible_the_day_before_their_birthday():
    """Born 2008-12-31. A `birth_year + 18 <= current_year` check says they are 18
    all through January 2027 and admits them eleven months early."""
    assert age_on("2008-12-31", date(2026, 12, 30)) == 17
    assert age_on("2008-12-31", date(2026, 12, 31)) == 18
    assert not meets_criteria("2008-12-31", 18, None, date(2026, 12, 30))
    assert meets_criteria("2008-12-31", 18, None, date(2026, 12, 31))


def test_a_leap_day_birthdate_against_a_lower_bound():
    """The `(month, day)` tuple comparison is the path that goes wrong here. Born
    on the 29th, this person's birthday in a non-leap year falls on 1 March, so
    they are still 17 on 28 February 2026 and only 18 the next day. A
    `birth_year + 18 <= 2026` check would call them 18 from January."""
    assert age_on("2008-02-29", date(2026, 2, 28)) == 17
    assert not meets_criteria("2008-02-29", 18, None, date(2026, 2, 28))
    assert meets_criteria("2008-02-29", 18, None, date(2026, 3, 1))


def test_age_ignores_the_time_of_day():
    assert age_on("2008-10-01", date(2026, 10, 1)) == 18


# --------------------------------------------------------------------------
# The rule's four shapes
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "dob,age,expected",
    [
        ("2010-10-01", 16, True),  # exactly on the lower bound
        ("2009-10-02", 16, True),
        ("2010-10-02", 15, False),  # one day younger
        ("1926-10-01", 100, True),  # exactly on the upper bound, birthday today
        ("1925-09-30", 101, False),  # one day past the upper bound
        ("2000-01-01", 26, True),
        ("1910-01-01", 116, False),
    ],
)
def test_both_bounds_are_inclusive(dob, age, expected):
    """Both bounds admit the person who is exactly that age. A rule of "18 and
    over" must not mean "19 and over" because of an off-by-one."""
    assert age_on(dob, TODAY) == age
    assert meets_criteria(dob, 16, 100, TODAY) is expected


def test_a_minimum_alone_admits_everyone_above_it():
    assert meets_criteria("1950-01-01", 18, None, TODAY)
    assert not meets_criteria("2015-01-01", 18, None, TODAY)


def test_a_maximum_alone_admits_everyone_below_it():
    assert meets_criteria("2005-01-01", None, 25, TODAY)
    assert not meets_criteria("1990-01-01", None, 25, TODAY)


def test_no_bounds_admits_everyone():
    for dob in ("1850-01-01", "2020-01-01", TODAY.isoformat()):
        assert meets_criteria(dob, None, None, TODAY)


def test_an_impossible_range_admits_nobody():
    assert not meets_criteria("2000-01-01", 30, 20, TODAY)


def test_a_future_birthdate_is_under_age_not_an_error():
    assert age_on("2030-01-01", TODAY) == -4
    assert not meets_criteria("2030-01-01", 18, None, TODAY)


def test_a_date_that_does_not_exist_raises_for_the_model_layer_to_reject():
    """It passes the `\\d{4}-\\d{2}-\\d{2}` pattern, so this is where a 500 would
    come from if pydantic did not catch it first."""
    with pytest.raises(ValueError):
        age_on("1996-02-31", TODAY)
    with pytest.raises(ValueError):
        age_on("not-a-date", TODAY)


# --------------------------------------------------------------------------
# The published proof
# --------------------------------------------------------------------------


def test_the_hash_is_stable_for_the_same_rule():
    assert criteria_hash(18, None) == criteria_hash(18, None)


def test_the_hash_distinguishes_the_three_shapes():
    # A minimum is not a maximum: 18-and-over must not hash as under-18.
    assert criteria_hash(18, None) != criteria_hash(None, 18)
    assert criteria_hash(18, None) != criteria_hash(19, None)
    assert criteria_hash(18, 25) != criteria_hash(18, None)
    assert criteria_hash(None, None) != criteria_hash(0, None)


def test_the_hash_is_a_sha256_hex_digest():
    digest = criteria_hash(18, None)
    assert len(digest) == 64
    assert all(character in "0123456789abcdef" for character in digest)


# --------------------------------------------------------------------------
# The wording a refusal uses — never the applicant's own age
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "min_age,max_age,expected",
    [
        (None, None, "This election has no age limit"),
        (18, None, "This election is for people aged 18 and over"),
        (None, 25, "This election is for people aged 25 and under"),
        (18, 25, "This election is for people aged 18 to 25"),
    ],
)
def test_the_rule_is_described_without_revealing_anyone_s_age(min_age, max_age, expected):
    assert describe(min_age, max_age) == expected