import datetime as dt
import hashlib
import tempfile
import unittest
from pathlib import Path

from app.config import Config
from app.ipa import eligibility as el, macho
from app.ipa.archive import IpaError
from app.job_runner import run_validation
from app.logging_config import redact
from tests.fixtures import make_ipa

NOW = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
APP = {"bundleIdentifier": "com.example.app"}
SIGN_OK = {"verification": "valid"}


def prov(**o):
    p = {"present": True, "profileType": "ad_hoc", "expired": False, "expiresAt": "2026-06-01T00:00:00Z", "appIdMatchesBundle": True}
    p.update(o)
    return p


class EligibilityTests(unittest.TestCase):
    def a(self, app=APP, signing=SIGN_OK, p=None, errors=None, ok=True, exp=None):
        return el.assess(app, signing, p or prov(), errors or [], ok, exp, NOW)["status"]

    def test_ad_hoc_eligible(self):
        self.assertEqual(self.a(), "eligible")

    def test_unsigned_not_eligible(self):
        self.assertEqual(self.a(signing={"verification": "unsigned"}), "not_eligible")

    def test_unknown_signature_needs_review(self):
        self.assertEqual(self.a(signing={"verification": "not_performed"}), "needs_review")

    def test_no_profile_needs_review(self):
        self.assertEqual(self.a(p={"present": False, "profileType": "none"}), "needs_review")

    def test_expired_not_eligible(self):
        self.assertEqual(self.a(p=prov(expired=True)), "not_eligible")

    def test_mismatch_not_eligible(self):
        self.assertEqual(self.a(p=prov(appIdMatchesBundle=False)), "not_eligible")

    def test_enterprise_and_dev_have_warnings(self):
        self.assertEqual(self.a(p=prov(profileType="enterprise")), "eligible_with_warnings")
        self.assertEqual(self.a(p=prov(profileType="development")), "eligible_with_warnings")

    def test_soon_expiring_warns(self):
        self.assertEqual(self.a(p=prov(expiresAt="2026-01-05T00:00:00Z")), "eligible_with_warnings")

    def test_app_store_needs_review(self):
        self.assertEqual(self.a(p=prov(profileType="app_store")), "needs_review")

    def test_expected_bundle_mismatch(self):
        self.assertEqual(self.a(exp="com.other"), "needs_review")

    def test_errors_make_not_eligible(self):
        self.assertEqual(self.a(errors=[{"code": "X", "message": "m"}]), "not_eligible")


class RunnerTests(unittest.TestCase):
    def cfg(self, tmp):
        return Config("https://x", "t" * 30, "w", Path(tmp) / "work", 1, 1, 10**9, 10**10, 1000, 10, 10, "INFO", "")

    def job(self, p: Path, **over):
        data = p.read_bytes()
        j = {"jobId": "j", "downloadUrl": "https://example/files/tok", "expected": {"sha256": hashlib.sha256(data).hexdigest(), "sizeBytes": len(data), "bundleIdentifier": None}}
        j["expected"].update(over)
        return j

    def test_pipeline_on_fixture_without_apple_tooling_is_honest(self):
        with tempfile.TemporaryDirectory() as tmp:
            ipa = make_ipa(Path(tmp) / "a.ipa")
            fetch = lambda url, dest: dest.write_bytes(ipa.read_bytes())  # noqa: E731
            stages = []
            report = run_validation(self.job(ipa), self.cfg(tmp), lambda s, p, m: stages.append(s), fetch)
            self.assertEqual(report["schemaVersion"], 1)
            self.assertEqual(report["app"]["bundleIdentifier"], "com.example.test")
            self.assertIn("integrity_check", stages)
            self.assertIn("eligibility_assessment", stages)
            # A synthetic, unsigned fixture can NEVER come back eligible.
            self.assertIn(report["eligibilityStatus"], ("needs_review", "not_eligible"))
            self.assertNotIn("executable", report["app"])
            # workspace removed
            self.assertEqual(list((Path(tmp) / "work").glob("job-*")), [])

    def test_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            ipa = make_ipa(Path(tmp) / "a.ipa")
            with self.assertRaises(IpaError) as cm:
                run_validation(self.job(ipa, sha256="0" * 64), self.cfg(tmp), lambda *a: None, lambda u, d: d.write_bytes(ipa.read_bytes()))
            self.assertEqual(cm.exception.code, "IPA_INTEGRITY_MISMATCH")
            self.assertEqual(list((Path(tmp) / "work").glob("job-*")), [])  # cleaned up on failure too

    def test_missing_info_plist(self):
        with tempfile.TemporaryDirectory() as tmp:
            ipa = make_ipa(Path(tmp) / "a.ipa", with_info=False)
            with self.assertRaises(IpaError) as cm:
                run_validation(self.job(ipa), self.cfg(tmp), lambda *a: None, lambda u, d: d.write_bytes(ipa.read_bytes()))
            self.assertEqual(cm.exception.code, "IPA_INFO_PLIST_MISSING")

    def test_macho_arch(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "bin"
            p.write_bytes(b"\xcf\xfa\xed\xfe\x0c\x00\x00\x01" + b"\x00" * 32)
            self.assertEqual(macho.architectures(p), ["arm64"])


class LogRedactionTests(unittest.TestCase):
    def test_redacts_secrets(self):
        s = redact("GET https://portal.example.com/api/v1/files/abc.def?x=1 Authorization: Bearer wkr_secretvalue leaseToken=abcDEF123")
        self.assertNotIn("abc.def", s)
        self.assertNotIn("secretvalue", s)
        self.assertNotIn("abcDEF123", s)


if __name__ == "__main__":
    unittest.main()
