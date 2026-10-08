"""Lazy re-export of the FastAPI app.

Deliberately not `from .app import app`. Importing that at package level meant
that *any* `from backend import <anything>` ran `init_db()` against the real
data/elections.db — which is how `tests/conftest.py` (which only needs the crypto
helpers) ended up opening, and validating, a developer's actual election history.
"""

from typing import Any

__all__ = ["app"]


def __getattr__(name: str) -> Any:
    if name == "app":
        from .app import app

        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
