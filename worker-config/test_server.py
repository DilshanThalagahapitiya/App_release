import os, tempfile, unittest
from pathlib import Path
os.environ["WORKER_CONFIG_ENV"] = str(Path(tempfile.mkdtemp()) / ".env")
import server  # noqa: E402


class T(unittest.TestCase):
    def test_validate(self):
        ok, err = server.validate("https://ipa-platform-prod.myerplk.workers.dev/", "wkr_" + "a" * 30)
        self.assertIsNone(err); self.assertEqual(ok["PLATFORM_URL"], "https://ipa-platform-prod.myerplk.workers.dev")
        for bad_url in ["http://evil.com", "https://x.dev/path", "javascript:alert(1)", "ftp://a.b"]:
            self.assertIsNotNone(server.validate(bad_url, None)[1], bad_url)
        for bad_key in ["abc", "wkr_short", "wkr_" + "a" * 30 + " ; rm -rf", "xyz_" + "a" * 30]:
            self.assertIsNotNone(server.validate(None, bad_key)[1], bad_key)
        self.assertEqual(server.validate("http://127.0.0.1:8799", None)[0]["PLATFORM_URL"], "http://127.0.0.1:8799")
        self.assertEqual(server.validate("", "")[0], {})

    def test_env_write_keeps_other_lines_and_is_private(self):
        p = Path(tempfile.mkdtemp()) / ".env"
        p.write_text("# keep\nPLATFORM_URL=https://old.example\nPOLL_INTERVAL_SECONDS=9\n")
        server.write_env({"PLATFORM_URL": "https://new.example", "WORKER_TOKEN": "wkr_x"}, p)
        text = p.read_text()
        self.assertIn("# keep", text); self.assertIn("POLL_INTERVAL_SECONDS=9", text)
        self.assertIn("PLATFORM_URL=https://new.example", text); self.assertNotIn("old.example", text); self.assertIn("WORKER_TOKEN=wkr_x", text)
        self.assertEqual(oct(p.stat().st_mode & 0o777), "0o600")
        self.assertEqual(server.read_env(p)["WORKER_TOKEN"], "wkr_x")

    def test_mask_and_log_redaction(self):
        key = "wkr_ExAmPleKeyNotReal1234567890abcdefXYZ"
        self.assertEqual(server.mask(key), key[:8] + "…" + key[-4:])
        self.assertEqual(server.mask(""), "")
        redacted = server.SECRET_RE.sub("wkr_…", "token " + key + " used")
        self.assertNotIn("ExAmPleKey", redacted)

    def test_host_check(self):
        self.assertTrue(server.host_ok(f"127.0.0.1:{server.PORT}"))
        self.assertTrue(server.host_ok(f"localhost:{server.PORT}"))
        self.assertFalse(server.host_ok("evil.com")); self.assertFalse(server.host_ok(None)); self.assertFalse(server.host_ok("127.0.0.1.evil.com:8765"))


if __name__ == "__main__":
    unittest.main()


class Store(unittest.TestCase):
    def setUp(self):
        server.STORE_FILE = Path(tempfile.mkdtemp()) / "keys.json"

    def test_remember_forget_and_privacy(self):
        server.remember("https://a.example", "wkr_" + "a" * 30)
        server.remember("https://b.example", "wkr_" + "b" * 30)
        server.remember("https://a.example", "wkr_" + "c" * 30)  # newer key for A replaces A only
        st = server.load_store()
        self.assertEqual(st["https://a.example"]["key"], "wkr_" + "c" * 30)
        self.assertEqual(st["https://b.example"]["key"], "wkr_" + "b" * 30)
        self.assertEqual(oct(server.STORE_FILE.stat().st_mode & 0o777), "0o600")
        self.assertTrue(server.forget("https://b.example")); self.assertFalse(server.forget("https://b.example"))
        self.assertNotIn("https://b.example", server.load_store())

    def test_status_never_returns_the_full_key(self):
        server.ENV_FILE = Path(tempfile.mkdtemp()) / ".env"
        server.write_env({"PLATFORM_URL": "https://a.example", "WORKER_TOKEN": "wkr_" + "z" * 40})
        s = server.status()
        self.assertNotIn("z" * 20, json_dump(s)); self.assertTrue(s["saved"][0]["active"])
        self.assertIn("https://a.example", server.load_store())


def json_dump(o):
    import json
    return json.dumps(o)
