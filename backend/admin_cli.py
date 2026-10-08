"""Admin account management from the command line.

The database and the audit log are plain files in ./data, so anyone who can run
Python in this directory already owns them. These commands sit on that same
trust boundary — they are a convenience for recovering from a forgotten
passphrase, not a security boundary of their own.
"""

import getpass
import sys

from . import auth
from .database import get_connection, init_db

MIN_NAME = 1
MAX_NAME = 64


def _prompt_name() -> str:
    return input("Admin name: ").strip()


def _prompt_passphrase(confirm: bool) -> str:
    while True:
        passphrase = getpass.getpass("Passphrase: ")
        if len(passphrase) < auth.MIN_ADMIN_PASSPHRASE:
            print(f"  must be at least {auth.MIN_ADMIN_PASSPHRASE} characters")
            continue
        if confirm and passphrase != getpass.getpass("Confirm passphrase: "):
            print("  passphrases did not match")
            continue
        return passphrase


def create_admin() -> int:
    init_db()
    name = _prompt_name()
    if not name or len(name) > MAX_NAME:
        print("Name must be 1-64 characters.")
        return 1
    passphrase = _prompt_passphrase(confirm=True)

    with get_connection() as conn:
        if auth.admin_count(conn) == 0:
            print("No admins exist. Use `python run.py --create-admin` once, then --reset-admin.")
            return 1
        if auth.find_admin(conn, name) is not None:
            print(f"An admin named {name} already exists.")
            return 1
        auth.create_admin(conn, name, passphrase)
    print(f"Created admin {name}.")
    return 0


def reset_admin() -> int:
    """Overwrite an existing admin's passphrase, or create one if none exist."""
    init_db()
    name = _prompt_name()
    if not name:
        print("Name must not be blank.")
        return 1
    passphrase = _prompt_passphrase(confirm=False)

    with get_connection() as conn:
        existing = auth.find_admin(conn, name)
        if existing is None:
            if auth.admin_count(conn) == 0:
                auth.create_admin(conn, name, passphrase)
                print(f"Created admin {name}.")
            else:
                print(f"No admin named {name}. Create one with --create-admin.")
                return 1
        else:
            salt, verifier = auth.make_admin_verifier(passphrase)
            conn.execute(
                "UPDATE admins SET salt = ?, verifier = ? WHERE name = ?", (salt, verifier, name)
            )
            conn.commit()
            # Existing sessions were issued against the old credential, so drop
            # them: a passphrase reset should end access held under the old one.
            conn.execute("DELETE FROM sessions WHERE subject = ?", (name,))
            conn.commit()
            print(f"Reset passphrase for {name} and ended their sessions.")
    return 0


def list_admins() -> int:
    init_db()
    with get_connection() as conn:
        rows = conn.execute("SELECT name, created_at FROM admins ORDER BY name").fetchall()
    if not rows:
        print("No admins. Create one with `python run.py --create-admin`.")
        return 0
    for row in rows:
        print(f"{row['name']}\t{row['created_at']}")
    return 0


def mint_bootstrap_code() -> int:
    """Print a fresh first-run code, if the bootstrap is still outstanding."""
    init_db()
    with get_connection() as conn:
        if auth.admin_count(conn) > 0:
            print("An admin already exists, so the first-run code is no longer accepted.")
            return 0
    auth.mint_bootstrap_code()
    return 0


COMMANDS = {
    "create-admin": create_admin,
    "reset-admin": reset_admin,
    "list-admins": list_admins,
    "bootstrap-code": mint_bootstrap_code,
}


def main(argv: list[str]) -> int:
    if len(argv) != 1 or not argv[0].startswith("--"):
        print(f"usage: python run.py [--{ ' | --'.join(COMMANDS) }]")
        return 2
    command = argv[0][2:]
    if command not in COMMANDS:
        print(f"unknown command: {argv[0]}")
        print(f"usage: python run.py [--{ ' | --'.join(COMMANDS) }]")
        return 2
    try:
        return COMMANDS[command]()
    except KeyboardInterrupt:
        print()
        return 130
