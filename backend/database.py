import sqlite3
from pathlib import Path

from .config import DB_PATH, DATA_DIR, KEYS_DIR, AUDIT_LOG_PATH


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    AUDIT_LOG_PATH.touch(exist_ok=True)


def get_connection() -> sqlite3.Connection:
    ensure_directories()
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    ensure_directories()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS elections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                starts_at TEXT,
                ends_at TEXT,
                master_passphrase TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        columns = conn.execute("PRAGMA table_info(elections)").fetchall()
        column_names = {row[1] for row in columns}
        if "master_passphrase" not in column_names:
            conn.execute("ALTER TABLE elections ADD COLUMN master_passphrase TEXT")

        voter_columns = conn.execute("PRAGMA table_info(voters)").fetchall()
        if not voter_columns:
            conn.execute(
                """
                CREATE TABLE voters (
                    id TEXT NOT NULL,
                    election_id TEXT NOT NULL,
                    public_key TEXT NOT NULL,
                    key_path TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'registered',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id, election_id),
                    FOREIGN KEY (election_id) REFERENCES elections(id)
                )
                """
            )
        else:
            pk_columns = [row[1] for row in voter_columns if row[5] > 0]
            if pk_columns == ["id"]:
                conn.execute(
                    """
                    CREATE TABLE voters_new (
                        id TEXT NOT NULL,
                        election_id TEXT NOT NULL,
                        public_key TEXT NOT NULL,
                        key_path TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'registered',
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (id, election_id),
                        FOREIGN KEY (election_id) REFERENCES elections(id)
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO voters_new (id, election_id, public_key, key_path, status, created_at)
                    SELECT id, election_id, public_key, key_path, status, created_at FROM voters
                    """
                )
                conn.execute("DROP TABLE voters")
                conn.execute("ALTER TABLE voters_new RENAME TO voters")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ballots (
                id TEXT PRIMARY KEY,
                election_id TEXT NOT NULL,
                voter_id TEXT NOT NULL,
                ballot_data TEXT NOT NULL,
                commitment TEXT NOT NULL,
                signature TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (election_id) REFERENCES elections(id),
                FOREIGN KEY (voter_id) REFERENCES voters(id)
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
