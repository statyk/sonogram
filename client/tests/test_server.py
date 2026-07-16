import pytest

from sonogram import config, server
from sonogram.signing import generate_private_key, private_key_to_b64


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    monkeypatch.setenv("SONOGRAM_CONFIG_DIR", str(tmp_path / "sonogram"))
    return tmp_path / "sonogram"


class FakeClient:
    def __init__(self, status=None, messages=None):
        self._status = status or {"agent": "llama", "is_owner": False, "agents": [], "channels": [], "unread": {}}
        self._messages = messages or {}
        self.sent = []
        self.cursors = []

    def status(self):
        return self._status

    def read(self, target, since=None):
        return self._messages.get(target, [])

    def send(self, target, body, subject=None, thread_id=None):
        self.sent.append((target, body, subject, thread_id))
        return 7

    def set_cursor(self, target, last_read):
        self.cursors.append((target, last_read))


def test_format_digest_empty():
    out = server.format_digest("llama", {})
    assert "No new messages" in out


def test_format_digest_renders_messages_and_mark_read_hint():
    messages = {
        "llama": [{"id": 3, "from": "radio", "target": "llama", "subject": "hi", "thread_id": None,
                   "body": "hello there", "created_at": 1752600000000}],
        "#coord": [{"id": 4, "from": "radio", "target": "#coord", "subject": None, "thread_id": "t9",
                    "body": "channel msg", "created_at": 1752600000000}],
    }
    out = server.format_digest("llama", messages)
    assert "radio" in out and "hello there" in out and "channel msg" in out
    assert "sonogram_mark_read" in out
    assert "[3]" in out and "[4]" in out
    assert "untrusted" in out.lower()


def test_check_uses_client(tmp_config, monkeypatch):
    fake = FakeClient(
        status={"agent": "llama", "is_owner": False, "agents": [], "channels": ["#coord"],
                "unread": {"llama": 1}},
        messages={"llama": [{"id": 1, "from": "radio", "target": "llama", "subject": None,
                             "thread_id": None, "body": "ping", "created_at": 0}]},
    )
    monkeypatch.setattr(server, "get_client", lambda: fake)
    out = server.sonogram_check()
    assert "ping" in out


def test_send_returns_confirmation(tmp_config, monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(server, "get_client", lambda: fake)
    out = server.sonogram_send("radio", "hello", subject="s")
    assert "7" in out
    assert fake.sent == [("radio", "hello", "s", None)]


def test_mark_read(tmp_config, monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(server, "get_client", lambda: fake)
    out = server.sonogram_mark_read("llama", 9)
    assert fake.cursors == [("llama", 9)]
    assert "9" in out


def test_init_owner_mode_no_invite(tmp_config, monkeypatch):
    out = server.sonogram_init("https://relay.test", "owner", invite_code="")
    assert config.is_initialized()
    assert "public key" in out.lower()
    # prints the pubkey for wrangler secret setup
    from sonogram.signing import public_key_b64
    assert public_key_b64(config.load_key()) in out


def test_init_with_invite_registers(tmp_config, monkeypatch):
    calls = {}

    def fake_register(relay_url, invite_code, name, pubkey, transport=None):
        calls["args"] = (relay_url, invite_code, name)
        return {"ok": True, "name": name}

    monkeypatch.setattr(server, "register", fake_register)
    out = server.sonogram_init("https://relay.test", "llama", invite_code="code123")
    assert calls["args"] == ("https://relay.test", "code123", "llama")
    assert config.is_initialized()
    assert "registered" in out.lower()


def test_init_refuses_double_init(tmp_config, monkeypatch):
    server.sonogram_init("https://relay.test", "owner", invite_code="")
    out = server.sonogram_init("https://relay.test", "owner", invite_code="")
    assert "already initialized" in out.lower()
