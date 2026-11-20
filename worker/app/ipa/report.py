from __future__ import annotations

from typing import Any, Dict, List

LIMITATIONS = [
    "Signature check uses `codesign --verify --deep --strict`; it confirms bundle integrity, not that Apple trusts the certificate or that it is unrevoked.",
    "The provisioning profile CMS envelope is decoded with `security cms`; the certificate chain inside the profile is not validated against Apple's roots.",
    "Device UDID registration cannot be checked here: the target device is unknown, so Ad Hoc/Development installs are never guaranteed.",
    "The application was inspected statically; it was never executed.",
]


class ReportBuilder:
    def __init__(self) -> None:
        self.checks: List[Dict[str, str]] = []
        self.warnings: List[str] = []
        self.errors: List[Dict[str, str]] = []
        self.limitations: List[str] = list(LIMITATIONS)

    def check(self, code: str, status: str, message: str) -> None:
        self.checks.append({"code": code, "status": status, "message": message[:1000]})

    def error(self, code: str, message: str) -> None:
        self.errors.append({"code": code, "message": message[:1000]})
        self.check(code, "failed", message)

    def limit(self, text: str) -> None:
        if text not in self.limitations:
            self.limitations.append(text)

    def build(self, *, size: int, sha256: str, app: Dict[str, Any], signing: Dict[str, Any], prov: Dict[str, Any],
              entitlements: Dict[str, Any], eligibility: str, overall: str, warnings: List[str]) -> Dict[str, Any]:
        app = {k: v for k, v in app.items() if k != "executable"}
        return {
            "schemaVersion": 1,
            "overallStatus": overall,
            "eligibilityStatus": eligibility,
            "file": {"sizeBytes": size, "sha256": sha256},
            "app": app,
            "signing": signing,
            "provisioning": prov,
            "entitlements": entitlements,
            "checks": self.checks[:100],
            "warnings": (self.warnings + warnings)[:50],
            "errors": self.errors[:50],
            "limitations": self.limitations[:50],
        }
