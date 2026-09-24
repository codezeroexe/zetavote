import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def reset_project_state():
    data_dir = ROOT / "data"
    keys_dir = data_dir / "keys"
    db_path = data_dir / "elections.db"
    audit_path = data_dir / "votes_audit.log"

    if keys_dir.exists():
        shutil.rmtree(keys_dir)
    if db_path.exists():
        db_path.unlink()
    if audit_path.exists():
        audit_path.unlink()

    yield

    if keys_dir.exists():
        shutil.rmtree(keys_dir)
    if db_path.exists():
        db_path.unlink()
    if audit_path.exists():
        audit_path.unlink()
