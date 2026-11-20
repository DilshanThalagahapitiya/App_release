from __future__ import annotations

import datetime as dt
import subprocess
from typing import Any, Dict, Optional

from .plist_reader import parse_plist


def decode_profile(raw: bytes, timeout: int) -> Dict[str, Any]:
    """`security cms -D` verifies the CMS envelope and prints the plist. Raw bytes are never logged."""
    proc = subprocess.run(["/usr/bin/security", "cms", "-D"], input=raw, capture_output=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        raise ValueError("security cms could not decode the provisioning profile")
    return parse_plist(proc.stdout)


def _iso(v: Any) -> Optional[str]:
    if isinstance(v, dt.datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=dt.timezone.utc)
        return v.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    return None


def summarise_profile(p: Dict[str, Any], bundle_id: Optional[str], now: Optional[dt.datetime] = None) -> Dict[str, Any]:
    """Facts only. Registered device identifiers (UDIDs) are listed so staff can check who is covered."""
    now = now or dt.datetime.now(dt.timezone.utc)
    ent = p.get("Entitlements") if isinstance(p.get("Entitlements"), dict) else {}
    devices = p.get("ProvisionedDevices")
    all_devices = bool(p.get("ProvisionsAllDevices"))
    get_task_allow = ent.get("get-task-allow")
    if all_devices:
        ptype = "enterprise"
    elif isinstance(devices, list):
        ptype = "development" if get_task_allow is True else "ad_hoc"
    else:
        ptype = "development" if get_task_allow is True else "app_store"
    exp = p.get("ExpirationDate")
    expired = None
    if isinstance(exp, dt.datetime):
        exp_aware = exp if exp.tzinfo else exp.replace(tzinfo=dt.timezone.utc)
        expired = exp_aware < now
    app_id = ent.get("application-identifier") if isinstance(ent.get("application-identifier"), str) else None
    teams = p.get("TeamIdentifier")
    team = teams[0] if isinstance(teams, list) and teams and isinstance(teams[0], str) else None
    matches = None
    if app_id and bundle_id and team:
        suffix = app_id[len(team) + 1:] if app_id.startswith(team + ".") else app_id
        matches = suffix == "*" or suffix == bundle_id or (suffix.endswith("*") and bundle_id.startswith(suffix[:-1]))
    return {
        "present": True,
        "profileType": ptype,
        "name": p.get("Name") if isinstance(p.get("Name"), str) else None,
        "uuid": p.get("UUID") if isinstance(p.get("UUID"), str) else None,
        "teamIdentifier": team,
        "applicationIdentifier": app_id,
        "createdAt": _iso(p.get("CreationDate")),
        "expiresAt": _iso(exp),
        "expired": expired,
        "deviceRegistrationRequired": isinstance(devices, list),
        "deviceCount": len(devices) if isinstance(devices, list) else None,
        "devices": sorted({d for d in devices if isinstance(d, str)})[:5000] if isinstance(devices, list) else None,
        "appIdMatchesBundle": matches,
    }
