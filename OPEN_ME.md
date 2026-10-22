# How to open ZetaVote

ZetaVote runs entirely on your own computer. Nothing is sent to the internet.

## What you need

- **Python 3.11 or newer.** Check with `python3 --version` (Windows: `python --version`).
  Download from https://www.python.org/downloads/ if it is missing.
- **That's it.** The web interface is already built and included in `frontend/dist`.
  Node.js is only needed if you want to change the interface (see the end of this file).

## 1. Unzip and open a terminal in the folder

Unzip `zetavote-handover.zip`, then open a terminal inside the unzipped `zetavote` folder.

- **Mac:** right-click the folder in Finder, then New Terminal at Folder.
- **Windows:** open the folder, click the address bar, type `cmd`, press Enter.

## 2. Install the Python packages (first time only)

Mac / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows:

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 3. Create the admin account (first time only)

```bash
python run.py --create-admin
```

It asks for an admin name and a passphrase. Write the passphrase down: it cannot be recovered.

## 4. Start the app

```bash
python run.py
```

Then open **http://127.0.0.1:8080** in Chrome, Edge, Safari or Firefox.
Leave the terminal open while you use the app. Press `Ctrl+C` in the terminal to stop it.

Next time, you only need to open a terminal in the folder, activate the environment
(`source .venv/bin/activate` or `.venv\Scripts\activate`) and run `python run.py`.

## Trying it out

1. **As admin:** on the sign-in page choose **Admin**, sign in, and create an election.
   You will set a *master passphrase* for that election. It is never stored, and you need it
   to close voting and count votes.
2. **As a voter:** choose **Voter**, then **Create account**. Join the election, cast a vote,
   and save the receipt code and private key it gives you.
3. **Finish:** as admin, open the election's **Manage** menu and choose **Close voting**,
   then **Count votes**.
4. **Check:** as the voter, open **Results** or **Verify** and check your receipt was counted.

Use made-up names and passphrases. This is a prototype for demonstration, not for real elections.

## Where data lives

Everything is in the `data/` folder that appears after the first run: the database, the keys
and the activity record. Delete `data/` to start completely fresh.

## Troubleshooting

- **"Address already in use":** another program uses port 8080. Run on another port:
  `ZV_PORT=8090 python run.py` (Windows: `set ZV_PORT=8090` then `python run.py`) and open
  http://127.0.0.1:8090.
- **"python3: command not found" on Windows:** use `python` instead of `python3`.
- **Blank page:** make sure you opened `http://127.0.0.1:8080`, not the `frontend` folder.

## For developers

- Run the tests: `pytest -q`.
- Change the interface: install Node.js 20+, then in `frontend/` run `npm install` and
  `npm run dev` (opens on port 5173 with live reload, talking to `python run.py` on 8080).
  Run `npm run build` to update `frontend/dist` for the plain `python run.py` setup.
- Architecture and conventions: see `CLAUDE.md` and `README.md`.
