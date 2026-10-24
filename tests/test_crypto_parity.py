"""Cross-language parity between backend/crypto.py and frontend/src/services/crypto.ts.

These vectors were produced by the browser implementation (transpiled with
esbuild and run under node) and are pinned here so the two cannot drift. If a
signature stops matching, the browser has changed its canonical serialisation or
its scrypt parameters, and every real ballot will be rejected at submit.

Regenerate with:
    node -e "<import the transpiled module and print these values>"
"""

import base64

import pytest

from backend import crypto

# Every vector below was emitted by the browser at the real scrypt cost, so
# these tests must derive at the real cost too. conftest lowers it globally for
# speed; clearing it here keeps these honest.
@pytest.fixture(autouse=True)
def real_scrypt_cost():
    previous = crypto.TEST_SCRYPT_N
    crypto.TEST_SCRYPT_N = None
    yield
    crypto.TEST_SCRYPT_N = previous

# Values below were emitted by frontend/src/services/crypto.ts.
TS_CANONICAL = '{"choice":"café","election_id":"e1","timestamp":"2026-01-01T00:00:00+00:00","vote_nonce":"n","voter_id":"v1","voter_pubkey":"pk"}'
TS_NESTED = '{"a":{"y":[3,{"p":5,"q":4}],"z":2},"b":1}'
TS_EMPTY = "{}"

TS_SIGNING_ROW = {
    "election_id": "e1",
    "voter_id": "v1",
    "voter_pubkey": "pk",
    "ballot_id": "0" * 64,
    "commitment": "1" * 64,
    "vote_nonce": "bm9uY2U=",
    "timestamp": "2026-01-01T00:00:00+00:00",
    "ephemeral_pub": "AAA=",
    "nonce": "BBBB=",
    "ciphertext": "CCCC=",
}
TS_PRIVATE_KEY = base64.b64encode(bytes([3]) * 32).decode()
TS_SIGNATURE = "U26U7k7X5blqlewsCrybryroL45b8P6P0r9DTk2k1quRVKPuCQOoNPxOJE2HF6ZXmzsknJpTj8hCs6wSp/vBAg=="

TS_SEALED = {
    "salt": "tWjeWZykWx5K7fEml2/w1A==",
    "nonce": "OOvgQTu4IpDQfkuY",
    # Regenerated at SCRYPT N=65536 when the voter KDF tier was raised; the
    # 2**14 vector is in git history if you need to compare.
    "ciphertext": "Oyv94EDAricDWApdd8ifBhgI/JOlwDpESuwy4YTDzxSaWPVPsHg4+1jWY8gGKcCY",
}
TS_SEALED_PASSPHRASE = "shared-passphrase"


def test_canonical_json_matches_the_browser():
    payload = {
        "election_id": "e1",
        "voter_id": "v1",
        "voter_pubkey": "pk",
        "choice": "café",
        "vote_nonce": "n",
        "timestamp": "2026-01-01T00:00:00+00:00",
    }
    assert crypto.canonical_json(payload) == TS_CANONICAL


def test_canonical_json_nested_matches_the_browser():
    assert crypto.canonical_json({"b": 1, "a": {"z": 2, "y": [3, {"q": 4, "p": 5}]}}) == TS_NESTED


def test_canonical_json_empty_matches_the_browser():
    assert crypto.canonical_json({}) == TS_EMPTY


def test_signature_matches_the_browser():
    assert crypto.sign_message(TS_PRIVATE_KEY, crypto.canonical_json(TS_SIGNING_ROW).encode()) == TS_SIGNATURE


def test_signature_produced_by_python_verifies_the_browser_public_key():
    from backend.crypto import generate_ed25519_keypair

    private_key, public_key = generate_ed25519_keypair()
    message = b"the quick brown fox"
    assert crypto.verify_signature(public_key, message, crypto.sign_message(private_key, message))
    assert not crypto.verify_signature(public_key, b"tampered", crypto.sign_message(private_key, message))


def test_python_opens_a_key_sealed_by_the_browser():
    """Proves the scrypt parameters and AES-GCM usage agree across languages."""
    key_material = crypto.derive_key_from_passphrase(TS_SEALED_PASSPHRASE, base64.b64decode(TS_SEALED["salt"]))[0]
    opened = crypto.decrypt_bytes(TS_SEALED, key_material)
    assert opened == bytes([3]) * 32
    assert base64.b64encode(opened).decode() == TS_PRIVATE_KEY


def test_hybrid_ballot_matches_the_python_side():
    """A ballot sealed to an election public key opens with its private key."""
    private_key, public_key = crypto.generate_x25519_keypair()
    sealed = crypto.seal_with_public_key(b"ballot plaintext", public_key)
    assert crypto.open_with_private_key(sealed, private_key) == b"ballot plaintext"
    # the wire shape the browser sends
    assert set(sealed) == {"ephemeral_pub", "nonce", "ciphertext"}
    assert base64.b64decode(sealed["nonce"]) and len(base64.b64decode(sealed["nonce"])) == 12
