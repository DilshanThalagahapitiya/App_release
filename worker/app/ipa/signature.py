from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from .plist_reader import parse_plist


def tool(name: str) -> Optional[str]:
    return shutil.which(name)


def _run(args: List[str], timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL, check=False)


def verify_signature(app: Path, timeout: int) -> Dict[str, Any]:
    """codesign verifies the sealed resources and CodeDirectory hashes. It does NOT prove Apple trusts the
    certificate chain for installation, nor does it check revocation — recorded as limitations in the report."""
    cs = tool("codesign")
    if not cs:
        return {"verification": "not_performed", "identitySummary": None, "teamIdentifier": None, "authorities": []}
    v = _run([cs, "--verify", "--deep", "--strict", str(app)], timeout)
    d = _run([cs, "-dvv", str(app)], timeout)  # details are written to stderr
    text = d.stderr or ""
    authorities = re.findall(r"^Authority=(.+)$", text, re.M)[:5]
    team = re.search(r"^TeamIdentifier=(.+)$", text, re.M)
    if v.returncode == 0:
        status = "valid"
    elif "not signed at all" in (v.stderr or ""):
        status = "unsigned"
    else:
        status = "invalid"
    return {
        "verification": status,
        "identitySummary": authorities[0] if authorities else None,
        "teamIdentifier": team.group(1).strip() if team and team.group(1).strip() != "not set" else None,
        "authorities": authorities,
    }


def read_entitlements(app: Path, timeout: int) -> Dict[str, Any]:
    cs = tool("codesign")
    out: Dict[str, Any] = {}
    if not cs:
        return out
    r = subprocess.run([cs, "-d", "--entitlements", ":-", str(app)], capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL, check=False)
    if r.returncode != 0 or not r.stdout.strip():
        return out
    try:
        ent = parse_plist(r.stdout)
    except Exception:  # noqa: BLE001
        return out
    domains = ent.get("com.apple.developer.associated-domains")
    return {
        "applicationIdentifier": ent.get("application-identifier") if isinstance(ent.get("application-identifier"), str) else None,
        "getTaskAllow": ent.get("get-task-allow") if isinstance(ent.get("get-task-allow"), bool) else None,
        "apsEnvironment": ent.get("aps-environment") if isinstance(ent.get("aps-environment"), str) else None,
        "associatedDomainsCount": len(domains) if isinstance(domains, list) else 0,
        "keys": sorted(str(k)[:120] for k in ent.keys())[:100],
    }
