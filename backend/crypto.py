import base64
import os

from cryptography.hazmat.primitives import hashes, hmac, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt


def generate_ed25519_keypair() -> tuple[str, str]:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )

    return base64.b64encode(private_bytes).decode("ascii"), base64.b64encode(public_bytes).decode("ascii")


def derive_key_from_passphrase(passphrase: str, salt: bytes | None = None) -> tuple[bytes, bytes]:
    salt = os.urandom(16) if salt is None else salt
    kdf = Scrypt(salt=salt, length=32, n=2**14, r=8, p=1)
    key = kdf.derive(passphrase.encode("utf-8"))
    return key, salt


def encrypt_bytes(data: bytes, key: bytes) -> dict[str, str]:
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, data, None)
    return {
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }


def decrypt_bytes(payload: dict[str, str], key: bytes) -> bytes:
    nonce = base64.b64decode(payload["nonce"])
    ciphertext = base64.b64decode(payload["ciphertext"])
    return AESGCM(key).decrypt(nonce, ciphertext, None)


def sign_message(private_key_b64: str, message: bytes) -> str:
    private_key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(private_key_b64))
    return base64.b64encode(private_key.sign(message)).decode("ascii")


def verify_signature(public_key_b64: str, message: bytes, signature_b64: str) -> bool:
    public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
    try:
        public_key.verify(base64.b64decode(signature_b64), message)
        return True
    except Exception:
        return False


def sha256_hex(value: str) -> str:
    digest = hashes.Hash(hashes.SHA256())
    digest.update(value.encode("utf-8"))
    return digest.finalize().hex()


def compute_commitment(choice: str, vote_nonce: str) -> str:
    message = f"{choice}:{vote_nonce}".encode("utf-8")
    digest = hashes.Hash(hashes.SHA256())
    digest.update(message)
    return digest.finalize().hex()
