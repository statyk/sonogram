"""End-to-end test: real relay under wrangler dev, two real clients.

Run via e2e/run.sh (it starts/stops the relay). Exits non-zero on failure.
"""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent.parent / "client" / "src"))

from sonogram.api import RelayClient, RelayError, register  # noqa: E402
from sonogram.signing import generate_private_key, public_key_b64  # noqa: E402

PORT = int(os.environ.get("E2E_PORT", "8787"))
RELAY = f"http://127.0.0.1:{PORT}"
REPO = Path(__file__).parent.parent


def wait_for_relay(deadline_s: float = 60.0) -> None:
    start = time.time()
    while time.time() - start < deadline_s:
        try:
            httpx.get(f"{RELAY}/status", timeout=2.0)
            return  # any HTTP response (even 401) means the relay is up
        except httpx.TransportError:
            time.sleep(0.5)
    raise RuntimeError("relay did not come up")


def expect(cond: bool, what: str) -> None:
    if not cond:
        raise AssertionError(f"FAILED: {what}")
    print(f"  ok: {what}")


def main() -> int:
    owner_key = generate_private_key()

    wrangler = subprocess.Popen(
        [
            "npx", "wrangler", "dev", "--port", str(PORT),
            "--var", "OWNER_NAME:shawn",
            "--var", f"OWNER_PUBKEY:{public_key_b64(owner_key)}",
        ],
        cwd=REPO / "relay",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,  # own process group so we can kill workerd children
    )
    try:
        wait_for_relay()
        owner = RelayClient(RELAY, "shawn", owner_key)

        st = owner.status()
        expect(st["agent"] == "shawn" and st["is_owner"], "owner bootstrapped from env")

        code = owner.admin_invite("radio")
        radio_key = generate_private_key()
        register(RELAY, code, "radio", public_key_b64(radio_key))
        radio = RelayClient(RELAY, "radio", radio_key)
        expect(radio.status()["agent"] == "radio", "friend enrolled via invite")

        msg_id = radio.send("shawn", "hello from radio", subject="e2e", thread_id="t1")
        st = owner.status()
        expect(st["unread"].get("shawn") == 1, "owner sees 1 unread DM")
        msgs = owner.read("shawn")
        expect(msgs[0]["from"] == "radio" and msgs[0]["body"] == "hello from radio", "DM delivered")
        owner.set_cursor("shawn", msg_id)
        expect(owner.read("shawn") == [], "cursor advanced, inbox drained")

        owner.admin_channel_create("coord", ["shawn", "radio"])
        radio.send("#coord", "channel says hi")
        chan_msgs = owner.read("#coord")
        expect(len(chan_msgs) == 1 and chan_msgs[0]["target"] == "#coord", "channel message delivered")

        owner.admin_revoke("radio")
        try:
            radio.status()
            expect(False, "revoked agent rejected")
        except RelayError as e:
            expect(e.status == 403, "revoked agent rejected with 403")

        print("E2E PASS")
        return 0
    finally:
        _terminate(wrangler)


def _terminate(proc: subprocess.Popen) -> None:
    """Terminate the wrangler process and its whole group.

    wrangler spawns a workerd child; killing only the npx process leaves an
    orphaned workerd holding the port. We started the process in its own
    session (start_new_session=True), so signal the entire process group.
    """
    if proc.poll() is not None:
        return
    try:
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            proc.kill()
        proc.wait(timeout=5)


if __name__ == "__main__":
    sys.exit(main())
