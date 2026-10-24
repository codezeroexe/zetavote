"""Every path the frontend calls must exist on the backend.

This exists because the drift is silent. The frontend's wire types are
hand-written, so renaming a field or a path segment in FastAPI produces a
TypeScript build that still compiles and a 404 at runtime — the exact class of
bug that cost three stages of this migration.

Deliberately checks paths only, not methods or payload fields. Extracting a
method from the `request(path, { method })` call shape is fragile, and a wrong
method is caught by any test that exercises the flow; a renamed path is caught by
nothing.
"""

import re
from pathlib import Path

import pytest

from backend.app import app

ROOT = Path(__file__).resolve().parents[1]
API_TS = ROOT / "frontend" / "src" / "services" / "api.ts"


def called_paths() -> set[str]:
    source = API_TS.read_text()
    # Template literals and plain strings passed to request(). `${...}` becomes a
    # wildcard, since the segment it stands for is a path parameter, and the
    # query string is dropped: a route matches on its path alone.
    raw = re.findall(r"request<[^>]*>\(\s*`([^`]+)`", source)
    raw += re.findall(r'request<[^>]*>\(\s*"(/api[^"]+)"', source)
    return {
        re.sub(r"\$\{[^}]+\}", "{x}", path.split("?")[0]) for path in raw
    }


def route_matcher(path: str) -> re.Pattern[str]:
    """A backend route path compiled to a matcher, `{param}` matching anything."""
    pattern = re.sub(r"\{[^}]+\}", "[^/]+", re.escape(path).replace(r"\{", "{").replace(r"\}", "}"))
    return re.compile(f"^{pattern}$")


BACKEND_PATHS = [route.path for route in app.routes if getattr(route, "path", "").startswith("/api")]


def test_the_frontend_calls_at_least_one_endpoint():
    assert called_paths(), f"no API paths found in {API_TS}"


@pytest.mark.parametrize("called", sorted(called_paths()))
def test_every_frontend_path_exists_on_the_backend(called):
    assert any(route_matcher(path).match(called) for path in BACKEND_PATHS), (
        f"{API_TS.name} calls {called!r}, which matches no backend route. "
        f"Backend has: {sorted(BACKEND_PATHS)}"
    )


@pytest.mark.parametrize("path", sorted(BACKEND_PATHS))
def test_no_orphaned_backend_routes(path):
    """The other direction: a route nothing calls is either dead code or a call
    the frontend spells differently."""
    pattern = route_matcher(path)
    assert any(pattern.match(called) for called in called_paths()), (
        f"{path} is served but nothing in the frontend calls it"
    )
