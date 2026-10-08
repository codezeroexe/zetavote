import os
import sys

from backend.app import app

if __name__ == "__main__":
    # Admin account management, e.g. `python run.py --reset-admin`. The database
    # is a local file, so this runs on the same trust boundary as the app itself.
    if len(sys.argv) > 1 and sys.argv[1].startswith("-"):
        from backend import admin_cli

        raise SystemExit(admin_cli.main(sys.argv[1:]))

    import uvicorn

    # Default to loopback. This is a local, single-machine app and the README
    # describes it as such; binding every interface would expose an unauthenticated
    # election API to the whole LAN. Override with ZV_HOST for a deliberate
    # network deployment.
    uvicorn.run(
        app,
        host=os.environ.get("ZV_HOST", "127.0.0.1"),
        port=int(os.environ.get("ZV_PORT", "8080")),
    )
