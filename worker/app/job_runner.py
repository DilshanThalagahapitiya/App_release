from __future__ import annotations

import logging
import shutil
import sys
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .config import Config
from .ipa import archive, eligibility, entitlements as ent_cmp, macho, plist_reader, provisioning_profile, signature
from .ipa.report import ReportBuilder
from .storage.temporary_files import job_workspace

log = logging.getLogger("runner")
Progress = Callable[[str, int, str], None]


class RetryableError(Exception):
    """Infrastructure problem (network, missing tool, disk) — safe to retry on another attempt."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def download(url: str, dest: Path, max_bytes: int, timeout: int) -> None:
    """Stream the IPA to disk through the short-lived signed URL. The URL itself is never logged."""
    req = urllib.request.Request(url, headers={"User-Agent": "ipa-worker"})
    written = 0
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, "wb") as f:
            while True:
                chunk = r.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise archive.IpaError("IPA_TOO_LARGE", f"Download exceeded the {max_bytes} byte limit.")
                f.write(chunk)
    except archive.IpaError:
        raise
    except Exception as e:  # noqa: BLE001
        raise RetryableError("DOWNLOAD_FAILED", f"Could not download the IPA: {type(e).__name__}")


def tool_status() -> Dict[str, bool]:
    return {n: shutil.which(n) is not None for n in ("codesign", "security", "unzip", "plutil")} | {"darwin": sys.platform == "darwin"}


def run_validation(job: Dict[str, Any], cfg: Config, progress: Progress, fetch: Callable[[str, Path], None] = None) -> Dict[str, Any]:
    """Run every inspection stage and return the structured report. Raises IpaError (definitive) or RetryableError."""
    expected = job["expected"]
    rb = ReportBuilder()
    with job_workspace(cfg.work_dir) as ws:
        ipa = ws / "package.ipa"
        progress("integrity_check", 5, "Downloading package")
        (fetch or (lambda u, d: download(u, d, cfg.max_ipa_bytes, cfg.download_timeout)))(job["downloadUrl"], ipa)

        size = ipa.stat().st_size
        digest = archive.sha256_file(ipa)
        if size != expected["sizeBytes"]:
            raise archive.IpaError("IPA_INTEGRITY_MISMATCH", "Downloaded size does not match the uploaded record.")
        if digest != expected["sha256"]:
            raise archive.IpaError("IPA_INTEGRITY_MISMATCH", "SHA-256 does not match the uploaded record.")
        if size > cfg.max_ipa_bytes:
            raise archive.IpaError("IPA_TOO_LARGE", "File exceeds the worker size limit.")
        rb.check("CHECKSUM_MATCH", "passed", "SHA-256 and size match the upload record.")

        progress("structure_inspection", 25, "Inspecting archive")
        info = archive.inspect_archive(ipa, cfg.max_zip_entries, cfg.max_uncompressed_bytes)
        rb.check("ZIP_INTEGRITY", "passed", f"ZIP integrity verified ({info.entry_count} entries).")
        rb.check("IPA_STRUCTURE_VALID", "passed", "Exactly one Payload/<name>.app bundle was found.")

        progress("metadata_extraction", 45, "Reading Info.plist")
        raw = archive.read_member(ipa, f"{info.app_dir_name}/Info.plist")
        if raw is None:
            raise archive.IpaError("IPA_INFO_PLIST_MISSING", "Info.plist was not found in the app bundle.")
        app = plist_reader.extract_app_info(plist_reader.parse_plist(raw))
        if not app["bundleIdentifier"]:
            raise archive.IpaError("IPA_BUNDLE_ID_MISSING", "CFBundleIdentifier is missing.")
        rb.check("INFO_PLIST_PARSED", "passed", "Info.plist parsed.")

        app_dir = ws / "extracted"
        signing: Dict[str, Any] = {"verification": "not_performed", "identitySummary": None, "teamIdentifier": None, "authorities": []}
        entitlements: Dict[str, Any] = {}
        prov: Dict[str, Any] = {"present": False, "profileType": "none"}
        can_sign_check = sys.platform == "darwin" and shutil.which("codesign") and shutil.which("security")

        progress("signature_inspection", 60, "Inspecting signature and provisioning profile")
        if can_sign_check:
            try:
                bundle = archive.extract_for_codesign(ipa, app_dir, cfg.subprocess_timeout)
            except archive.IpaError:
                raise
            except Exception as e:  # noqa: BLE001
                raise RetryableError("EXTRACT_FAILED", f"Extraction failed: {type(e).__name__}")
            exe = bundle / app["executable"] if app.get("executable") else None
            app["architectures"] = macho.architectures(exe) if exe and exe.is_file() else []
            signing = signature.verify_signature(bundle, cfg.subprocess_timeout)
            rb.check("CODESIGN_VERIFY", "passed" if signing["verification"] == "valid" else "failed", f"codesign verification: {signing['verification']}")
            entitlements = signature.read_entitlements(bundle, cfg.subprocess_timeout)
        else:
            rb.check("CODESIGN_VERIFY", "not_performed", "codesign/security are unavailable (not macOS).")
            rb.limit("This report was produced without Apple tooling; signature and profile checks were NOT performed.")
            app["architectures"] = []

        raw_prof = archive.read_member(ipa, f"{info.app_dir_name}/embedded.mobileprovision")
        if raw_prof is None:
            rb.check("PROFILE_PRESENT", "warning", "No embedded.mobileprovision in the bundle.")
        elif can_sign_check:
            try:
                prov = provisioning_profile.summarise_profile(provisioning_profile.decode_profile(raw_prof, cfg.subprocess_timeout), app["bundleIdentifier"])
                rb.check("PROFILE_DECODED", "passed", f"Provisioning profile decoded (type: {prov['profileType']}).")
            except Exception:  # noqa: BLE001
                rb.check("PROFILE_DECODED", "failed", "The provisioning profile could not be decoded.")
                prov = {"present": True, "profileType": "unknown"}
        else:
            prov = {"present": True, "profileType": "unknown"}
            rb.check("PROFILE_DECODED", "not_performed", "Profile present but cannot be decoded without `security`.")

        problems = ent_cmp.compare(entitlements, prov, app["bundleIdentifier"]) if entitlements and prov.get("present") else []
        for p in problems:
            rb.warnings.append(p)

        progress("eligibility_assessment", 90, "Assessing eligibility")
        verdict = eligibility.assess(app, signing, prov, rb.errors, True, expected.get("bundleIdentifier"))
        rb.check("ELIGIBILITY_ASSESSED", "passed", f"Eligibility: {verdict['status']}")
        return rb.build(size=size, sha256=digest, app=app, signing=signing, prov=prov, entitlements=entitlements,
                        eligibility=verdict["status"], overall="completed", warnings=verdict["reasons"] + verdict["warnings"])
