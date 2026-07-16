"""Local state: ~/.config/sonogram (override with SONOGRAM_CONFIG_DIR)."""

import os
import tomllib
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .signing import load_private_key


def config_dir() -> Path:
    override = os.environ.get("SONOGRAM_CONFIG_DIR")
    if override:
        return Path(override)
    return Path.home() / ".config" / "sonogram"


def save_config(relay_url: str, agent_name: str) -> None:
    d = config_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.toml").write_text(
        f'relay_url = "{relay_url}"\nagent_name = "{agent_name}"\n', encoding="utf-8"
    )


def load_config() -> dict:
    path = config_dir() / "config.toml"
    if not path.exists():
        raise FileNotFoundError(f"no config at {path} — run sonogram_init first")
    with path.open("rb") as f:
        data = tomllib.load(f)
    return {"relay_url": data["relay_url"], "agent_name": data["agent_name"]}


def save_key(b64: str) -> None:
    d = config_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = d / "key"
    path.write_text(b64 + "\n", encoding="utf-8")
    path.chmod(0o600)


def load_key() -> Ed25519PrivateKey:
    path = config_dir() / "key"
    if not path.exists():
        raise FileNotFoundError(f"no key at {path} — run sonogram_init first")
    return load_private_key(path.read_text(encoding="utf-8").strip())


def is_initialized() -> bool:
    d = config_dir()
    return (d / "config.toml").exists() and (d / "key").exists()
