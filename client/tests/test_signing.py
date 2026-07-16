import base64
import hashlib

from sonogram.signing import (
    generate_private_key,
    load_private_key,
    private_key_to_b64,
    public_key_b64,
    sign_headers,
    signing_string,
)


def test_key_roundtrip():
    key = generate_private_key()
    b64 = private_key_to_b64(key)
    restored = load_private_key(b64)
    assert public_key_b64(restored) == public_key_b64(key)
    raw = base64.b64decode(public_key_b64(key))
    assert len(raw) == 32


def test_signing_string_format():
    body = b'{"a":1}'
    s = signing_string("llama", "2026-07-16T12:00:00Z", "post", "/send", body)
    expected_hash = hashlib.sha256(body).hexdigest()
    assert s == f"llama\n2026-07-16T12:00:00Z\nPOST\n/send\n{expected_hash}"


def test_sign_headers_verify():
    key = generate_private_key()
    headers = sign_headers(key, "llama", "GET", "/status", b"", timestamp="2026-07-16T12:00:00Z")
    assert headers["x-sonogram-agent"] == "llama"
    assert headers["x-sonogram-timestamp"] == "2026-07-16T12:00:00Z"
    sig = base64.b64decode(headers["x-sonogram-signature"])
    assert len(sig) == 64
    # verify with the public key — raises InvalidSignature on failure
    key.public_key().verify(sig, signing_string("llama", "2026-07-16T12:00:00Z", "GET", "/status", b"").encode())


def test_sign_headers_default_timestamp_is_utc_iso():
    key = generate_private_key()
    headers = sign_headers(key, "llama", "GET", "/status", b"")
    assert headers["x-sonogram-timestamp"].endswith("Z")
