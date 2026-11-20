from __future__ import annotations

import datetime as dt
from typing import Any, Dict, List, Optional

# Mirrors src/lib/eligibility.ts. The platform API re-derives eligibility from these FACTS and keeps the
# more conservative verdict, so this function can only ever make a build look *worse* than the API would.
RANK = {"eligible": 0, "eligible_with_warnings": 1, "needs_review": 2, "not_eligible": 3}


def assess(app: Dict[str, Any], signing: Dict[str, Any], prov: Dict[str, Any], errors: List[Dict[str, str]],
           overall_ok: bool, expected_bundle_id: Optional[str] = None,
           now: Optional[dt.datetime] = None) -> Dict[str, Any]:
    now = now or dt.datetime.now(dt.timezone.utc)
    reasons: List[str] = []
    warnings: List[str] = []

    def out(status: str) -> Dict[str, Any]:
        return {"status": status, "reasons": reasons, "warnings": warnings}

    if not overall_ok or errors:
        reasons.append("Package inspection did not complete cleanly.")
        return out("not_eligible")
    if not app.get("bundleIdentifier"):
        reasons.append("No bundle identifier could be read from Info.plist.")
        return out("not_eligible")
    ver = signing.get("verification")
    if ver in ("unsigned", "invalid"):
        reasons.append(f"Code signature is {ver}.")
        return out("not_eligible")
    if ver != "valid":
        reasons.append("The code signature could not be verified on this worker.")
        return out("needs_review")
    if not prov.get("present"):
        reasons.append("No embedded provisioning profile (normal for App Store/TestFlight exports; not installable over the air).")
        return out("needs_review")
    expired = prov.get("expired")
    if expired is None:
        reasons.append("Provisioning profile expiry could not be determined.")
        return out("needs_review")
    if expired:
        reasons.append("The embedded provisioning profile has expired.")
        return out("not_eligible")
    if prov.get("appIdMatchesBundle") is False:
        reasons.append("Profile application identifier does not match the bundle identifier.")
        return out("not_eligible")
    if prov.get("appIdMatchesBundle") is None:
        warnings.append("Profile application identifier could not be compared with the bundle identifier.")
    if expected_bundle_id and expected_bundle_id != app.get("bundleIdentifier"):
        reasons.append("Bundle identifier differs from the project's expected identifier.")
        return out("needs_review")
    exp = prov.get("expiresAt")
    if exp:
        try:
            days = (dt.datetime.fromisoformat(exp.replace("Z", "+00:00")) - now).total_seconds() / 86400
            if days < 14:
                warnings.append(f"The provisioning profile expires in {max(0, int(days))} day(s).")
        except ValueError:
            pass
    ptype = prov.get("profileType")
    if ptype == "ad_hoc":
        warnings.insert(0, "Ad Hoc: installs only on devices whose UDID is registered in the provisioning profile.")
        return out("eligible_with_warnings" if len(warnings) > 1 else "eligible")
    if ptype == "enterprise":
        warnings.insert(0, "Enterprise: limited to qualifying organisations and internal proprietary use under Apple's current terms.")
        return out("eligible_with_warnings")
    if ptype == "development":
        warnings.insert(0, "Development-signed build: requires a development profile and registered devices; not general distribution.")
        return out("eligible_with_warnings")
    reasons.append("The provisioning profile type could not be determined or is App Store style.")
    return out("needs_review")
