"""Eligibility: who may vote in an election, as a rule rather than a list.

The admin states a rule — "aged 18 and over" — and anyone whose account satisfies
it may join. That moved the date of birth from a one-way fingerprint to a readable
column, because the server has to do arithmetic on it. Everything about that is
contained in one place, and the one thing that must never happen is the date
leaving the process: it is read here and in the enrolment endpoint, and goes
nowhere else.

Pure functions, `today` injected rather than read from the clock, so a boundary
case is a unit test rather than a coincidence of when the suite runs.
"""

from datetime import date

from .crypto import canonical_json, sha256_hex

# Above this, the bound is a typo rather than a policy: nobody is 9000.
MAX_PLAUSIBLE_AGE = 150


def age_on(dob: str, today: date) -> int:
    """Whole years lived on `today`.

    Deliberately not `today.year - born.year`. That shortcut is off by one in
    both directions and gets the dangerous one wrong: born 2008-12-31 satisfies
    `2008 + 18 <= 2027` in January 2027, while still being 17 until December —
    so an age rule would admit an underage voter for eleven months of the year.
    """
    born = date.fromisoformat(dob)
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def meets_criteria(dob: str, min_age: int | None, max_age: int | None, today: date) -> bool:
    """Whether `dob` satisfies the rule. A `None` bound is no bound at all."""
    age = age_on(dob, today)
    if min_age is not None and age < min_age:
        return False
    if max_age is not None and age > max_age:
        return False
    return True


def criteria_hash(min_age: int | None, max_age: int | None) -> str:
    """The published proof that the rule was not altered after the fact.

    Over the rule itself rather than over the roster it replaced, which is what
    makes it checkable: anyone reading the results can see "aged 18 and over" and
    recompute this. The old hash was over a salted name list that nobody outside
    this database could reproduce, so it proved less than it appeared to.
    """
    return sha256_hex(canonical_json({"max_age": max_age, "min_age": min_age}))


def describe(min_age: int | None, max_age: int | None) -> str:
    """The rule in words, for a refusal message.

    States the rule and never the applicant's age: the response must not become a
    way to confirm a birthdate the server now holds.
    """
    # `min_age=0` and no minimum are the same rule — everyone is 0 and over —
    # so it reads as no age limit rather than as the absurdity it literally is.
    # The hash deliberately does not normalise: it covers the rule as the admin
    # stated it, which is the thing being attested.
    if (min_age is None or min_age == 0) and max_age is None:
        return "This election has no age limit"
    if max_age is None:
        return f"This election is for people aged {min_age} and over"
    if min_age is None:
        return f"This election is for people aged {max_age} and under"
    return f"This election is for people aged {min_age} to {max_age}"