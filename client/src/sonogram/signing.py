"""Ed25519 request signing. Must produce byte-identical signing strings to relay/src/auth.ts."""

import base64
import hashlib
from datetime import datetime, timezone

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def generate_private_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


def private_key_to_b64(key: Ed25519PrivateKey) -> str:
    raw = key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return base64.b64encode(raw).decode("ascii")


def load_private_key(b64: str) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(b64))


def public_key_b64(key: Ed25519PrivateKey) -> str:
    raw = key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(raw).decode("ascii")


def signing_string(timestamp: str, method: str, path_with_query: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    return f"{timestamp}\n{method.upper()}\n{path_with_query}\n{body_hash}"


def sign_headers(
    key: Ed25519PrivateKey,
    agent: str,
    method: str,
    path_with_query: str,
    body: bytes,
    timestamp: str | None = None,
) -> dict[str, str]:
    ts = timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    signature = key.sign(signing_string(ts, method, path_with_query, body).encode("utf-8"))
    return {
        "x-sonogram-agent": agent,
        "x-sonogram-timestamp": ts,
        "x-sonogram-signature": base64.b64encode(signature).decode("ascii"),
    }
