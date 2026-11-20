from __future__ import annotations

import plistlib
from typing import Any, Dict, List, Optional

from .archive import IpaError


def parse_plist(data: bytes) -> Dict[str, Any]:
    try:
        value = plistlib.loads(data)
    except Exception as e:  # noqa: BLE001 - plistlib raises several types
        raise IpaError("IPA_PLIST_INVALID", f"Property list could not be parsed: {type(e).__name__}")
    if not isinstance(value, dict):
        raise IpaError("IPA_PLIST_INVALID", "Property list root is not a dictionary.")
    return value


def _s(v: Any, limit: int = 255) -> Optional[str]:
    return v[:limit] if isinstance(v, str) and v else None


def extract_app_info(info: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the documented identity fields. All values are untrusted strings and are length-limited."""
    families = info.get("UIDeviceFamily")
    if isinstance(families, int):
        families = [families]
    fam: List[int] = [f for f in families if isinstance(f, int)] if isinstance(families, list) else []
    return {
        "name": _s(info.get("CFBundleDisplayName")) or _s(info.get("CFBundleName")),
        "bundleIdentifier": _s(info.get("CFBundleIdentifier")),
        "version": _s(info.get("CFBundleShortVersionString"), 64),
        "buildNumber": _s(info.get("CFBundleVersion"), 64),
        "minimumOSVersion": _s(info.get("MinimumOSVersion"), 32),
        "deviceFamilies": fam[:8] or [1],  # Apple default when the key is absent is iPhone
        "executable": _s(info.get("CFBundleExecutable")),
    }
