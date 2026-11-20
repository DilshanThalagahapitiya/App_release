import tempfile
import unittest
from pathlib import Path

from app.ipa import archive
from tests.fixtures import add_symlink, make_ipa


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_valid_structure(self):
        p = make_ipa(self.tmp / "ok.ipa")
        info = archive.inspect_archive(p, 1000, 10**9)
        self.assertEqual(info.app_dir_name, "Payload/Fixture.app")

    def test_not_zip(self):
        p = self.tmp / "bad.ipa"
        p.write_bytes(b"not a zip at all")
        with self.assertRaises(archive.IpaError) as cm:
            archive.inspect_archive(p, 1000, 10**9)
        self.assertEqual(cm.exception.code, "IPA_NOT_ZIP")

    def test_path_traversal_rejected(self):
        p = make_ipa(self.tmp / "t.ipa", extra={"Payload/../../evil.txt": b"x"})
        with self.assertRaises(archive.IpaError) as cm:
            archive.inspect_archive(p, 1000, 10**9)
        self.assertEqual(cm.exception.code, "IPA_PATH_TRAVERSAL")

    def test_symlink_escape_rejected(self):
        p = make_ipa(self.tmp / "s.ipa")
        add_symlink(p, "Payload/Fixture.app/link", "../../../../etc/passwd")
        with self.assertRaises(archive.IpaError) as cm:
            archive.inspect_archive(p, 1000, 10**9)
        self.assertEqual(cm.exception.code, "IPA_UNSAFE_SYMLINK")

    def test_entry_limit(self):
        p = make_ipa(self.tmp / "e.ipa", extra={f"Payload/Fixture.app/f{i}": b"x" for i in range(20)})
        with self.assertRaises(archive.IpaError) as cm:
            archive.inspect_archive(p, 5, 10**9)
        self.assertEqual(cm.exception.code, "IPA_TOO_MANY_ENTRIES")

    def test_uncompressed_limit(self):
        p = make_ipa(self.tmp / "u.ipa", extra={"Payload/Fixture.app/big": b"0" * 100000})
        with self.assertRaises(archive.IpaError) as cm:
            archive.inspect_archive(p, 1000, 1000)
        self.assertEqual(cm.exception.code, "IPA_TOO_LARGE_UNCOMPRESSED")

    def test_no_app_bundle(self):
        import zipfile
        p = self.tmp / "n.ipa"
        with zipfile.ZipFile(p, "w") as z:
            z.writestr("readme.txt", "hi")
        with self.assertRaises(archive.IpaError) as cm:
            archive.inspect_archive(p, 1000, 10**9)
        self.assertEqual(cm.exception.code, "IPA_STRUCTURE_INVALID")

    def test_two_apps_rejected(self):
        p = make_ipa(self.tmp / "2.ipa", extra={"Payload/Other.app/Info.plist": b"x"})
        with self.assertRaises(archive.IpaError):
            archive.inspect_archive(p, 1000, 10**9)

    def test_sha256(self):
        p = self.tmp / "h.bin"
        p.write_bytes(b"abc")
        self.assertEqual(archive.sha256_file(p), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")


if __name__ == "__main__":
    unittest.main()
