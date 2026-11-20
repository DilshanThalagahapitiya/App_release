from __future__ import annotations

from typing import Any, Dict, List


def compare(entitlements: Dict[str, Any], profile: Dict[str, Any], bundle_id: str) -> List[str]:
    """Return human-readable mismatches between the signed entitlements and the embedded profile."""
    problems: List[str] = []
    app_id = entitlements.get("applicationIdentifier")
    p_app_id = profile.get("applicationIdentifier")
    if app_id and p_app_id and app_id != p_app_id and not str(p_app_id).endswith("*"):
        problems.append("Signed application-identifier differs from the provisioning profile.")
    if app_id and bundle_id and not str(app_id).endswith("." + bundle_id) and not str(app_id).endswith("*"):
        problems.append("Signed application-identifier does not end with the bundle identifier.")
    if entitlements.get("getTaskAllow") is True and profile.get("profileType") in ("ad_hoc", "enterprise", "app_store"):
        problems.append("get-task-allow is true for a distribution-type profile.")
    return problems
