import datetime as dt
import plistlib
import unittest

from app.ipa import plist_reader, provisioning_profile as pp
from app.ipa.archive import IpaError


class PlistTests(unittest.TestCase):
    def test_extracts_fields(self):
        info = plist_reader.parse_plist(plistlib.dumps({"CFBundleIdentifier": "a.b", "CFBundleName": "N", "UIDeviceFamily": [1, 2], "CFBundleVersion": "3"}))
        app = plist_reader.extract_app_info(info)
        self.assertEqual(app["bundleIdentifier"], "a.b")
        self.assertEqual(app["name"], "N")
        self.assertEqual(app["deviceFamilies"], [1, 2])

    def test_binary_plist(self):
        data = plistlib.dumps({"CFBundleIdentifier": "x.y"}, fmt=plistlib.FMT_BINARY)
        self.assertEqual(plist_reader.parse_plist(data)["CFBundleIdentifier"], "x.y")

    def test_garbage_rejected(self):
        with self.assertRaises(IpaError):
            plist_reader.parse_plist(b"\x00\x01 not plist")

    def test_values_are_length_limited(self):
        app = plist_reader.extract_app_info({"CFBundleIdentifier": "a" * 1000})
        self.assertEqual(len(app["bundleIdentifier"]), 255)


NOW = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)


def profile(**over):
    p = {"Name": "P", "UUID": "u", "TeamIdentifier": ["TEAM123456"], "CreationDate": NOW - dt.timedelta(days=30), "ExpirationDate": NOW + dt.timedelta(days=100),
         "Entitlements": {"application-identifier": "TEAM123456.com.example.app", "get-task-allow": False}, "ProvisionedDevices": ["UDID1", "UDID2"]}
    p.update(over)
    return p


class ProfileTests(unittest.TestCase):
    def test_ad_hoc(self):
        s = pp.summarise_profile(profile(), "com.example.app", NOW)
        self.assertEqual(s["profileType"], "ad_hoc")
        self.assertEqual(s["deviceCount"], 2)
        self.assertTrue(s["appIdMatchesBundle"])
        self.assertEqual(s["devices"], ["UDID1", "UDID2"])

    def test_development(self):
        p = profile(Entitlements={"application-identifier": "TEAM123456.com.example.app", "get-task-allow": True})
        self.assertEqual(pp.summarise_profile(p, "com.example.app", NOW)["profileType"], "development")

    def test_enterprise(self):
        p = profile(ProvisionsAllDevices=True)
        del p["ProvisionedDevices"]
        self.assertEqual(pp.summarise_profile(p, "com.example.app", NOW)["profileType"], "enterprise")

    def test_app_store(self):
        p = profile()
        del p["ProvisionedDevices"]
        self.assertEqual(pp.summarise_profile(p, "com.example.app", NOW)["profileType"], "app_store")

    def test_expired(self):
        p = profile(ExpirationDate=NOW - dt.timedelta(days=1))
        self.assertTrue(pp.summarise_profile(p, "com.example.app", NOW)["expired"])

    def test_bundle_mismatch_and_wildcard(self):
        self.assertFalse(pp.summarise_profile(profile(), "com.other.app", NOW)["appIdMatchesBundle"])
        w = profile(Entitlements={"application-identifier": "TEAM123456.*", "get-task-allow": False})
        self.assertTrue(pp.summarise_profile(w, "com.other.app", NOW)["appIdMatchesBundle"])


if __name__ == "__main__":
    unittest.main()
