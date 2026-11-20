from __future__ import annotations

from typing import Dict


def auth_headers(token: str) -> Dict[str, str]:
    """Static per-worker bearer credential (hashed server-side, revocable). Never logged."""
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "ipa-worker"}
