import base64
import hashlib
import hmac
import json
import os

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.primitives.hashes import SHA256

# scrypt cost. The browser side (frontend/src/crypto.ts) must pass exactly these
# values or the derived keys will not match.
#
# Two cost tiers, because the two keys have opposite access patterns. An
# election key is unsealed a handful of times in its life, so it can afford a
# very expensive derivation. A voter key is unsealed on every login, so it cannot.
# Both are raised well above the 2**14 that was used before: login fetches the
# sealed blob over HTTP, so an attacker can take that ciphertext home and grind
# it offline forever. Rate limiting does not help against that — only the cost
# does. A 6-character passphrase is hours of GPU time at 2**14 and infeasible here.
SCRYPT_N_VOTER = 2**16
SCRYPT_N_ELECTION = 2**18
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
SALT_BYTES = 16
GCM_NONCE_BYTES = 12

# Accepted for callers that predate the tier split; the voter tier is the
# conservative choice and matches what the browser defaults to.
SCRYPT_N = SCRYPT_N_VOTER

# Test-only cost ceiling. Deliberately NOT read from the environment at import:
# a stray env var in production would silently weaken every sealed key in the
# database. Only the test suite sets it (tests/conftest.py), and the parity
# tests that check real browser vectors clear it again.
#
# scrypt is ~80% of the suite's wall clock, because 82 of 100 tests share a
# fixture that derives twice (bootstrap + admin login) at the 2**18 tier.
TEST_SCRYPT_N: int | None = None


def _resolve_n(n: int) -> int:
    """Clamp a requested scrypt cost to the test-only ceiling, if one is set.

    Resolved on every call rather than bound as a default argument, so
    clearing TEST_SCRYPT_N takes effect immediately.
    """
    return TEST_SCRYPT_N or n


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def unb64(value: str) -> bytes:
    return base64.b64decode(value)


# --------------------------------------------------------------------------
# Ed25519 — voter identity. The server only ever verifies; after the client
# signs its own ballots the backend never holds a voter private key.
# --------------------------------------------------------------------------


def generate_ed25519_keypair() -> tuple[str, str]:
    private_key = Ed25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return b64(private_bytes), b64(private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    ))


def sign_message(private_key_b64: str, message: bytes) -> str:
    """Only the browser signs ballots now. The backend keeps this so the test
    suite can act as a client and pin the cross-language signature contract."""
    return b64(Ed25519PrivateKey.from_private_bytes(unb64(private_key_b64)).sign(message))


def verify_signature(public_key_b64: str, message: bytes, signature_b64: str) -> bool:
    try:
        key = Ed25519PublicKey.from_public_bytes(unb64(public_key_b64))
        key.verify(unb64(signature_b64), message)
        return True
    except Exception:
        return False


# --------------------------------------------------------------------------
# X25519 — election ballot sealing. A browser holds the public key only, does
# an ephemeral ECDH, and the election's private key (sealed under the master
# passphrase) is the only thing that can open the ballot.
# --------------------------------------------------------------------------


def generate_x25519_keypair() -> tuple[str, str]:
    private_key = X25519PrivateKey.generate()
    return (
        b64(private_key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )),
        b64(private_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
        )),
    )


def _shared_key(private_key_b64: str, peer_public_key_b64: str) -> bytes:
    private_key = X25519PrivateKey.from_private_bytes(unb64(private_key_b64))
    peer = X25519PublicKey.from_public_bytes(unb64(peer_public_key_b64))
    shared = private_key.exchange(peer)
    # Raw ECDH output is not uniformly random; HKDF is the standard way to turn
    # it into an AES key. salt=None is fine, info already binds the protocol.
    return HKDF(algorithm=SHA256(), length=32, salt=None, info=b"zetavote/ballot/v1").derive(shared)


def seal_with_public_key(data: bytes, public_key_b64: str) -> dict[str, str]:
    """Encrypt to a holder of the public key only. Used by the browser."""
    ephemeral_private, ephemeral_public = generate_x25519_keypair()
    key = _shared_key(ephemeral_private, public_key_b64)
    nonce = os.urandom(GCM_NONCE_BYTES)
    ciphertext = AESGCM(key).encrypt(nonce, data, None)
    return {"ephemeral_pub": ephemeral_public, "nonce": b64(nonce), "ciphertext": b64(ciphertext)}


def open_with_private_key(payload: dict[str, str], private_key_b64: str) -> bytes:
    """Inverse of seal_with_public_key. Only the master passphrase holder can."""
    key = _shared_key(private_key_b64, payload["ephemeral_pub"])
    return AESGCM(key).decrypt(unb64(payload["nonce"]), unb64(payload["ciphertext"]), None)


# --------------------------------------------------------------------------
# Passphrase key wrapping — seals the Ed25519 private key (voter) and the
# X25519 private key (election).
# --------------------------------------------------------------------------


def derive_key_from_passphrase(
    passphrase: str, salt: bytes | None = None, *, n: int = SCRYPT_N_VOTER
) -> tuple[bytes, bytes]:
    salt = os.urandom(SALT_BYTES) if salt is None else salt
    kdf = Scrypt(salt=salt, length=SCRYPT_DKLEN, n=_resolve_n(n), r=SCRYPT_R, p=SCRYPT_P)
    return kdf.derive(passphrase.encode("utf-8")), salt


def verify_passphrase(passphrase: str, salt_b64: str, expected_b64: str, *, n: int) -> bool:
    """Constant-time check of a passphrase against a stored scrypt verifier.

    Used for admin logins. Unlike the sealed-key path this is a normal
    credential check: the server is not holding a key it could unseal, so
    learning the passphrase grants nothing it could not already do.
    """
    derived = scrypt_derive(passphrase, unb64(salt_b64), n=n)
    return hmac.compare_digest(derived, unb64(expected_b64))


def scrypt_derive(passphrase: str, salt: bytes, *, n: int) -> bytes:
    kdf = Scrypt(salt=salt, length=SCRYPT_DKLEN, n=_resolve_n(n), r=SCRYPT_R, p=SCRYPT_P)
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt_bytes(data: bytes, key: bytes) -> dict[str, str]:
    nonce = os.urandom(GCM_NONCE_BYTES)
    return {"nonce": b64(nonce), "ciphertext": b64(AESGCM(key).encrypt(nonce, data, None))}


def decrypt_bytes(payload: dict[str, str], key: bytes) -> bytes:
    return AESGCM(key).decrypt(unb64(payload["nonce"]), unb64(payload["ciphertext"]), None)


# --------------------------------------------------------------------------
# Hashing
# --------------------------------------------------------------------------


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical_json(payload: object) -> str:
    """Byte-exact serialisation shared with frontend/src/crypto.ts.

    Sorted keys, no whitespace, and ensure_ascii=False so the output matches
    JSON.stringify for non-ASCII candidate names. The browser signs these exact
    bytes, so any drift here silently invalidates every signature.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def ballot_commitment(election_id: str, voter_pubkey: str, reveal_salt: str, choice: str) -> str:
    """Commit to a choice using a 32-byte salt only the voter holds.

    Because the salt is 256 bits of entropy, this cannot be brute-forced back
    to the choice by enumerating the candidate list the way the old
    SHA256(choice + user_typed_nonce) scheme could.
    """
    return sha256_hex(canonical_json({
        "election_id": election_id,
        "voter_pubkey": voter_pubkey,
        "reveal_salt": reveal_salt,
        "choice": choice,
    }))


def ballot_id(election_id: str, voter_pubkey: str, vote_nonce: str) -> str:
    """Replay key. Deliberately excludes the choice so that replaying a captured
    request with a different choice still collides on the primary key."""
    return sha256_hex(canonical_json({
        "election_id": election_id,
        "voter_pubkey": voter_pubkey,
        "vote_nonce": vote_nonce,
    }))
