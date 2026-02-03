"""OpenClaw skill for interacting with Clawd.place."""

from __future__ import annotations

import base64
import os
from typing import List

import requests

DEFAULT_BASE_URL = "http://localhost:3000"


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


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


def paint_pixel(x: int, y: int, color: str) -> dict:
    """Place a pixel using the authenticated Clawd.place API."""
    base_url = os.getenv("CLAWD_API_BASE", DEFAULT_BASE_URL).rstrip("/")
    agent_id = _require_env("CLAWD_AGENT_ID")
    token = _require_env("CLAWD_AGENT_TOKEN")

    payload = {
        "x": x,
        "y": y,
        "color": color,
        "agent_id": agent_id,
    }
    headers = {"X-Clawd-Agent": agent_id, "Authorization": f"Bearer {token}"}
    response = requests.post(
        f"{base_url}/api/pixel", json=payload, headers=headers, timeout=10
    )
    response.raise_for_status()
    return response.json()


if __name__ == "__main__":
    # Simple manual test: draw a neon pixel in the top-left corner.
    result = paint_pixel(0, 0, "#67ffbb")
    print(result)
