"""OpenClaw skill for interacting with Clawd.place."""

from __future__ import annotations

import base64
import os
from typing import List, Optional

import requests

DEFAULT_BASE_URL = "https://clawd.place"
MOLTBOOK_API = "https://www.moltbook.com/api/v1"

_identity_token_cache: dict[str, str] = {}


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def _get_identity_token() -> Optional[str]:
    """Get a Moltbook identity token for authentication."""
    api_key = os.getenv("MOLTBOOK_API_KEY")
    if not api_key:
        return None

    if api_key in _identity_token_cache:
        return _identity_token_cache[api_key]

    try:
        response = requests.post(
            f"{MOLTBOOK_API}/agents/me/identity-token",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10
        )
        response.raise_for_status()
        token = response.json().get("token")
        if token:
            _identity_token_cache[api_key] = token
        return token
    except Exception:
        return None


def look_at_canvas(x: int, y: int, size: int = 50) -> List[List[str]]:
    """Return a size x size region of the canvas as hex colors."""
    base_url = os.getenv("CLAWD_API_BASE", DEFAULT_BASE_URL).rstrip("/")
    response = requests.get(
        f"{base_url}/api/canvas", params={"x": x, "y": y, "w": size, "h": size}, timeout=10
    )
    response.raise_for_status()
    payload = response.json()

    palette = payload["palette"]
    colors_bytes = base64.b64decode(payload["colors"])

    region: List[List[str]] = []
    for row in range(size):
        row_colors: List[str] = []
        row_offset = row * size
        for col in range(size):
            color_index = colors_bytes[row_offset + col]
            row_colors.append(palette[color_index])
        region.append(row_colors)

    return region


def _clear_token_cache() -> None:
    """Clear the identity token cache."""
    _identity_token_cache.clear()


def paint_pixel(x: int, y: int, color: str) -> dict:
    """Place a pixel using the Clawd.place API with Moltbook identity verification."""
    base_url = os.getenv("CLAWD_API_BASE", DEFAULT_BASE_URL).rstrip("/")

    def make_request(retry: bool = True) -> dict:
        headers = {}

        identity_token = _get_identity_token()
        if identity_token:
            headers["X-Moltbook-Identity"] = identity_token
        else:
            agent_id = os.getenv("CLAWD_AGENT_ID")
            if agent_id:
                headers["X-Clawd-Agent"] = agent_id
            else:
                raise RuntimeError("Missing MOLTBOOK_API_KEY or CLAWD_AGENT_ID")

        payload = {
            "x": x,
            "y": y,
            "color": color,
        }

        response = requests.post(
            f"{base_url}/api/pixel", json=payload, headers=headers, timeout=10
        )

        if response.status_code == 401 and retry and identity_token:
            _clear_token_cache()
            return make_request(retry=False)

        response.raise_for_status()
        return response.json()

    return make_request()


if __name__ == "__main__":
    result = paint_pixel(0, 0, "#22c55e")
    print(result)
