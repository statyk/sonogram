import base64
import json

import httpx
import pytest

from sonogram.api import RelayClient, RelayError, register
from sonogram.signing import generate_private_key, public_key_b64, signing_string


@pytest.fixture
def key():
    return generate_private_key()


def make_client(key, handler):
    return RelayClient(
        "https://relay.test", "llama", key, transport=httpx.MockTransport(handler)
    )


def test_send_signs_request_and_returns_id(key):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": 42})

    client = make_client(key, handler)
    msg_id = client.send("radio", "hello", subject="s", thread_id="t")
    assert msg_id == 42

    req = captured["request"]
    assert req.url.path == "/send"
    payload = json.loads(req.content)
    assert payload == {"target": "radio", "body": "hello", "subject": "s", "thread_id": "t"}
    # signature verifies against the public key over the exact signing string
    sig = base64.b64decode(req.headers["x-sonogram-signature"])
    ts = req.headers["x-sonogram-timestamp"]
    agent = req.headers["x-sonogram-agent"]
    key.public_key().verify(sig, signing_string(agent, ts, "POST", "/send", req.content).encode())
    assert agent == "llama"


def test_read_signs_path_including_query(key):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"messages": [{"id": 1, "body": "x"}]})

    client = make_client(key, handler)
    messages = client.read("#coord", since=5)
    assert messages == [{"id": 1, "body": "x"}]

    req = captured["request"]
    path_with_query = req.url.raw_path.decode()
    assert "target=%23coord" in path_with_query and "since=5" in path_with_query
    sig = base64.b64decode(req.headers["x-sonogram-signature"])
    ts = req.headers["x-sonogram-timestamp"]
    agent = req.headers["x-sonogram-agent"]
    key.public_key().verify(sig, signing_string(agent, ts, "GET", path_with_query, b"").encode())


def test_relay_errors_raise(key):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "not a channel member"})

    client = make_client(key, handler)
    with pytest.raises(RelayError) as exc:
        client.send("#coord", "hi")
    assert exc.value.status == 403
    assert "not a channel member" in str(exc.value)


def test_oversized_body_rejected_before_sending(key):
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("should not reach the network")

    client = make_client(key, handler)
    with pytest.raises(RelayError) as exc:
        client.send("radio", "x" * (64 * 1024 + 1))
    assert "64" in str(exc.value)


def test_register_is_unsigned(key):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"ok": True, "name": "llama"})

    result = register(
        "https://relay.test", "codecode", "llama", public_key_b64(key),
        transport=httpx.MockTransport(handler),
    )
    assert result["ok"] is True
    req = captured["request"]
    assert "x-sonogram-signature" not in req.headers
    assert json.loads(req.content)["invite_code"] == "codecode"


def test_status_and_admin_methods(key):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/status":
            return httpx.Response(200, json={"agent": "llama", "unread": {}})
        if path == "/admin/invite":
            return httpx.Response(200, json={"invite_code": "abc123", "name": "radio"})
        if path == "/admin/channel":
            return httpx.Response(200, json={"ok": True, "channel": "#coord"})
        if path == "/admin/revoke":
            return httpx.Response(200, json={"ok": True})
        if path == "/cursor":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"error": "not found"})

    client = make_client(key, handler)
    assert client.status()["agent"] == "llama"
    assert client.admin_invite("radio") == "abc123"
    assert client.admin_channel_create("coord", ["llama", "radio"])["channel"] == "#coord"
    client.admin_revoke("radio")
    client.set_cursor("llama", 7)
