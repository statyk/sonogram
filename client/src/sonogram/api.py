"""HTTP client for the sonogram relay. Signs every request except register()."""

import json
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .signing import sign_headers

MAX_BODY_BYTES = 64 * 1024


class RelayError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"relay error {status}: {message}")
        self.status = status


def _raise_for_error(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except json.JSONDecodeError:
        data = {}
    if response.status_code >= 400:
        raise RelayError(response.status_code, data.get("error", response.text))
    return data


def register(
    relay_url: str,
    invite_code: str,
    name: str,
    public_key_b64: str,
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """Redeem an invite. Unsigned: the relay authenticates via the invite code."""
    body = json.dumps({"invite_code": invite_code, "name": name, "public_key": public_key_b64})
    with httpx.Client(transport=transport) as http:
        response = http.post(relay_url.rstrip("/") + "/register", content=body)
    return _raise_for_error(response)


class RelayClient:
    def __init__(
        self,
        relay_url: str,
        agent_name: str,
        private_key: Ed25519PrivateKey,
        transport: httpx.BaseTransport | None = None,
    ):
        self.relay_url = relay_url.rstrip("/")
        self.agent_name = agent_name
        self.private_key = private_key
        self._http = httpx.Client(transport=transport, timeout=30.0)

    def _request(self, method: str, path: str, params: dict | None = None, payload: dict | None = None) -> dict:
        path_with_query = path + ("?" + urlencode(params) if params else "")
        body = json.dumps(payload).encode("utf-8") if payload is not None else b""
        headers = sign_headers(self.private_key, self.agent_name, method, path_with_query, body)
        response = self._http.request(
            method,
            self.relay_url + path_with_query,
            content=body if payload is not None else None,
            headers=headers,
        )
        return _raise_for_error(response)

    def send(self, target: str, body: str, subject: str | None = None, thread_id: str | None = None) -> int:
        if len(body.encode("utf-8")) > MAX_BODY_BYTES:
            raise RelayError(413, "message body exceeds 64 KB limit")
        payload: dict = {"target": target, "body": body}
        if subject is not None:
            payload["subject"] = subject
        if thread_id is not None:
            payload["thread_id"] = thread_id
        return int(self._request("POST", "/send", payload=payload)["id"])

    def read(self, target: str, since: int | None = None) -> list[dict]:
        params: dict = {"target": target}
        if since is not None:
            params["since"] = since
        return self._request("GET", "/read", params=params)["messages"]

    def set_cursor(self, target: str, last_read: int) -> None:
        self._request("POST", "/cursor", payload={"target": target, "last_read": last_read})

    def status(self) -> dict:
        return self._request("GET", "/status")

    def admin_invite(self, name: str) -> str:
        return self._request("POST", "/admin/invite", payload={"name": name})["invite_code"]

    def admin_channel_create(self, name: str, members: list[str]) -> dict:
        return self._request("POST", "/admin/channel", payload={"name": name, "members": members})

    def admin_revoke(self, name: str) -> None:
        self._request("POST", "/admin/revoke", payload={"name": name})
