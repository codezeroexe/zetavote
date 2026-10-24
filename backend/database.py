import os
import sqlite3

from .config import AUDIT_LOG_PATH, DB_PATH, DATA_DIR, KEYS_DIR
from .crypto import SALT_BYTES, b64


def _add_column(conn: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    """Add a column to an existing table if it is not already there.

    SQLite has no `ADD COLUMN IF NOT EXISTS`, and every other table here is
    created with IF NOT EXISTS so an existing database keeps its data. This does
    the same for columns, so upgrading an older elections.db does not fail.
    """
    # init_db opens its own connection without the row_factory get_connection
    # sets, so PRAGMA output arrives as plain tuples.
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if existing and column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    AUDIT_LOG_PATH.touch(exist_ok=True)


#: Columns that must be present for the app to work. `accounts.dob` is the one
#: that matters: an older database stores `dob_hash` instead, and eligibility is
#: now arithmetic on a readable date of birth, so a one-way hash cannot be
#: migrated — it has to be replaced.
REQUIRED_COLUMNS = {"accounts": ("dob",)}


def refuse_stale_schema(conn: sqlite3.Connection) -> None:
    """Stop with an actionable message instead of a bare sqlite3 traceback.

    `CREATE TABLE IF NOT EXISTS` never upgrades an existing table, so a database
    written by an older version keeps its old columns and the first statement that
    mentions a new one raises `no such column`. That is the least friendly possible
    first run for a voting app, and the fix is one command the user can actually
    act on.
    """
    for table, required in REQUIRED_COLUMNS.items():
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if not existing:
            continue  # Not created yet; the CREATE TABLE below will make it right.
        missing = [column for column in required if column not in existing]
        if not missing:
            continue
        raise SystemExit(
            f"\n"
            f"ZetaVote cannot open {DB_PATH}.\n"
            f"\n"
            f"  The `{'`, `'.join(missing)}` column is missing from the `{table}` "
            f"table, so this database was written by an older version.\n"
            f"  It cannot be upgraded: the value it replaced was a one-way hash,\n"
            f"  and eligibility now needs the original date of birth back.\n"
            f"\n"
            f"  Move the file aside to start a fresh election history:\n"
            f"      mv {DB_PATH} {DB_PATH}.old\n"
            f"\n"
            f"  Nothing else on disk is touched.\n"
        )


def meta_value(conn: sqlite3.Connection, key: str, factory) -> str:
    """Read a persistent server-side secret, minting it on first use.

    The identity salt lives here rather than in a module constant because a
    fingerprint hashed under it has to still match on the next request, the next
    election, and the next run — and because a fixed salt would let anyone
    precompute fingerprints for every plausible name and date of birth offline.
    """
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    if row is not None:
        return row[0]
    value = factory()
    conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    return value


def identity_salt(conn: sqlite3.Connection) -> str:
    return meta_value(conn, "identity_salt", lambda: b64(os.urandom(SALT_BYTES)))


def get_connection() -> sqlite3.Connection:
    ensure_directories()
    init_db()
    conn = sqlite3.connect(DB_PATH)
    # SQLite ignores foreign key constraints unless this is on per connection.
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    ensure_directories()
    conn = sqlite3.connect(DB_PATH)
    try:
        refuse_stale_schema(conn)

        # Server-side secrets that must outlive a restart but never leave the
        # process. The identity salt is the only entry today.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

        # The master passphrase is never stored. The election's X25519 private
        # key is sealed under it, and a successful unseal is the proof of
        # admin — the same pattern the voter flow uses.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS elections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                starts_at TEXT,
                ends_at TEXT,
                public_key TEXT NOT NULL,
                sealed_private_key TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # Global voter accounts: one row per person, for life. `id` is the
        # username and the sole primary key, so uniqueness is enforced by the
        # schema. SQLite's default BINARY collation makes the comparison
        # case-sensitive (Asha0142 and asha0142 are distinct accounts) without
        # any COLLATE clause.
        #
        # public_key signs login challenges and nothing else. It deliberately
        # never appears on a ballot, so the audit log cannot link an account's
        # activity across elections.
        #
        # sealed_key is the account key sealed under a passphrase the server
        # never receives. It is stored ciphertext-only; the browser unlocks it
        # locally on each sign-in. Password-based login would be worse than
        # useless here, since the server cannot check it without holding the key.
        #
        # name_hash is a one-way salted fingerprint of the legal name, used only
        # to warn about duplicate accounts. Names stay hashed because the server
        # never needs to read one, and a name is the more identifying of the two.
        #
        # dob is NOT hashed, and is deliberately readable. Eligibility is a rule
        # rather than a list, so the server has to do arithmetic on the date of
        # birth — and a hash of a value you must read protects nothing that
        # reading it does not already expose. The cost is a real birthdate in the
        # database: it is never returned by any endpoint and never written to the
        # audit log, and a test enforces both.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name_hash TEXT NOT NULL,
                dob TEXT NOT NULL,
                public_key TEXT NOT NULL,
                sealed_key TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # Indexed but deliberately NOT unique. A hard block would lock out
        # legitimate duplicates such as twins, and it would not stop a deliberate
        # second account anyway. One account is one enrolment, which the
        # enrolments primary key enforces; nothing stops one person making two
        # accounts, and election_blocks is the only lever an admin has on that.
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_accounts_identity ON accounts(name_hash, dob)"
        )

        # One row per account per election. `ballot_public_key` is minted fresh
        # here rather than reused from the account, which is what keeps ballots
        # unlinkable across elections: no single key appears in more than one.
        #
        # The primary key is the whole one-person-one-enrolment rule now that
        # eligibility is a rule rather than a list of people to claim.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS enrolments (
                election_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                ballot_public_key TEXT NOT NULL,
                sealed_ballot_key TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (election_id, account_id),
                FOREIGN KEY (election_id) REFERENCES elections(id),
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            )
            """
        )

        # Admin-curated deny-list, per election. It may name an account that does
        # not exist yet, which is how a known duplicate is blocked before its
        # third attempt. It bars that one account and leaves everyone else alone,
        # so it cannot be used to lock out a whole birthdate.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS election_blocks (
                election_id TEXT NOT NULL,
                username TEXT NOT NULL,
                reason TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (election_id, username),
                FOREIGN KEY (election_id) REFERENCES elections(id)
            )
            """
        )

        # ephemeral_pub is the voter's throwaway X25519 public key; it is all the
        # server needs to open the ballot once the election private key is
        # unsealed. The plaintext choice is never stored.
        #
        # voter_id is the *account* that cast it, and the foreign key is what
        # makes a ballot impossible without an enrolment: the account must have
        # joined this election and met its age rule.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ballots (
                id TEXT PRIMARY KEY,
                election_id TEXT NOT NULL,
                voter_id TEXT NOT NULL,
                ephemeral_pub TEXT NOT NULL,
                nonce TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                commitment TEXT NOT NULL,
                signature TEXT NOT NULL,
                vote_nonce TEXT NOT NULL,
                ballot_timestamp TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (election_id) REFERENCES elections(id),
                FOREIGN KEY (election_id, voter_id) REFERENCES enrolments(election_id, account_id)
            )
            """
        )

        # Who may vote, as a rule rather than a list. NULL on either side is no
        # bound at all. Set once at creation and never edited.
        _add_column(conn, "elections", "min_age", "INTEGER")
        _add_column(conn, "elections", "max_age", "INTEGER")

        # SHA256 over the canonical JSON of {max_age, min_age}, computed once at
        # creation and published with the results. Anyone can read the rule off the
        # results and recompute this, which the old roster hash never allowed.
        _add_column(conn, "elections", "criteria_hash", "TEXT")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS candidates (
                election_id TEXT NOT NULL,
                name TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                PRIMARY KEY (election_id, name),
                FOREIGN KEY (election_id) REFERENCES elections(id)
            )
            """
        )

        # Admin accounts. `verifier` is a scrypt output, not the passphrase.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS admins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                salt TEXT NOT NULL,
                verifier TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # Sessions store only the token hash. The raw token exists once, in an
        # HttpOnly cookie that page JavaScript cannot read.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                subject TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS results (
                election_id TEXT PRIMARY KEY,
                total_votes INTEGER NOT NULL,
                choice_breakdown TEXT NOT NULL,
                merkle_root TEXT NOT NULL,
                published_at TEXT NOT NULL,
                FOREIGN KEY (election_id) REFERENCES elections(id)
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
