import stat

import pytest

from sonogram import config
from sonogram.signing import generate_private_key, private_key_to_b64, public_key_b64


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    monkeypatch.setenv("SONOGRAM_CONFIG_DIR", str(tmp_path / "sonogram"))
    return tmp_path / "sonogram"


def test_not_initialized_when_empty(tmp_config):
    assert config.is_initialized() is False
    with pytest.raises(FileNotFoundError):
        config.load_config()


def test_config_roundtrip(tmp_config):
    config.save_config("https://relay.example.workers.dev", "llama")
    loaded = config.load_config()
    assert loaded == {"relay_url": "https://relay.example.workers.dev", "agent_name": "llama"}


def test_key_roundtrip_and_permissions(tmp_config):
    key = generate_private_key()
    config.save_key(private_key_to_b64(key))
    loaded = config.load_key()
    assert public_key_b64(loaded) == public_key_b64(key)
    mode = stat.S_IMODE((tmp_config / "key").stat().st_mode)
    assert mode == 0o600


def test_initialized_when_both_present(tmp_config):
    config.save_config("https://x", "llama")
    config.save_key(private_key_to_b64(generate_private_key()))
    assert config.is_initialized() is True
