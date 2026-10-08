"""Username slugging. Pure functions, no database, no crypto.

An account id is the username, so the slug is the one place a person's legal
name is reduced to something typeable. Two deliberate limits:

- ASCII output only. Transliteration beyond the Latin alphabet needs a
  transliteration table (or a dependency); dropping the characters instead
  means a non-Latin name slugifies to "", which the caller surfaces as "choose
  your own stem" rather than a broken account.
- The four-digit suffix is never touched here. It is the user's to pick and is
  appended by the caller, so nothing in this module may lowercase or otherwise
  rewrite it.
"""

import hashlib
import re
import unicodedata

# Letters that carry a diacritic but no combining mark, so NFKD leaves them
# whole and an ASCII filter would delete them instead of folding them.
_FOLD = str.maketrans({
    "ø": "o", "ł": "l", "đ": "d", "ð": "d", "þ": "th",
    "æ": "ae", "œ": "oe", "ß": "ss", "ı": "i", "ŋ": "n",
})

# A stem of at least one lowercase ASCII letter, then exactly four digits.
# Deliberately no length cap: the slug comes from a real name, and a cap would
# refuse long names for a column that is only ever compared, never executed.
_USERNAME = re.compile(r"[a-z][a-z0-9]*[0-9]{4}\Z")

SUFFIX_SPACE = 10_000


def fingerprint(name: str, salt: str) -> str:
    """One-way fingerprint of a legal name, for this database.

    Hashed rather than stored so the database never holds a readable roster of
    everyone's name, and salted because a name is low-entropy enough that a fixed
    salt would let anyone precompute a hash for every plausible one offline. The
    salt is the whole reason this is not just sha256(name).

    The date of birth used to be fingerprinted alongside it. It is not any more:
    eligibility is a rule now, so the server has to read that date to do
    arithmetic on it, and hashing a value you must read buys nothing.

    Slugified first, so "José Álvarez", "jose alvarez" and "JOSE  ALVAREZ" are
    one person — otherwise the duplicate-account warning misses all three.
    """
    return hashlib.sha256(f"{salt}:name:{slugify(name)}".encode("utf-8")).hexdigest()


def slugify(name: str) -> str:
    """`Anne-Marie de la Cruz` -> `annemariedelacruz`.

    Accents are folded rather than stripped, so the slug stays pronounceable
    and two names that differ only by an accent do not land on the same stem
    more often than they already would.
    """
    decomposed = unicodedata.normalize("NFKD", name)
    unmarked = "".join(c for c in decomposed if not unicodedata.combining(c))
    return "".join(c for c in unmarked.lower().translate(_FOLD) if c.isascii() and c.isalnum())


def is_valid_username(username: str) -> bool:
    """Whether a username is shaped like a slug plus the four digits.

    Usernames are case-sensitive, so a mixed-case id is a genuinely different
    account from the one the user meant. The charset is the real guard here:
    the id lands in a primary key and a URL, and nothing else about it is
    load-bearing.
    """
    return bool(_USERNAME.match(username))


def suggest(base: str, taken) -> str | None:
    """The next free username after `base`, or None if there is none.

    Deterministic by construction: the same base and taken set always yield the
    same answer, so the same person is offered the same name on a second try.
    Walks the whole four-digit space before giving up rather than wrapping onto
    a name it has already seen.
    """
    if not is_valid_username(base):
        return None
    stem, digits = base[:-4], int(base[-4:])
    for step in range(1, SUFFIX_SPACE):
        candidate = f"{stem}{(digits + step) % SUFFIX_SPACE:04d}"
        if candidate not in taken:
            return candidate
    return None
