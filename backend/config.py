from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "elections.db"
AUDIT_LOG_PATH = DATA_DIR / "votes_audit.log"
KEYS_DIR = DATA_DIR / "keys"
