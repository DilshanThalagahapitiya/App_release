"""TEST FIXTURES ONLY. These synthetic archives are not real signed iOS apps."""
import io
import plistlib
import stat
import zipfile
from pathlib import Path


def make_ipa(path: Path, bundle_id="com.example.test", name="Fixture", extra=None, info_override=None, with_info=True):
    info = {"CFBundleIdentifier": bundle_id, "CFBundleDisplayName": name, "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "7", "MinimumOSVersion": "16.0", "UIDeviceFamily": [1, 2], "CFBundleExecutable": "Fixture"}
    info.update(info_override or {})
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        if with_info:
            z.writestr("Payload/Fixture.app/Info.plist", plistlib.dumps(info))
        z.writestr("Payload/Fixture.app/Fixture", b"\xcf\xfa\xed\xfe\x0c\x00\x00\x01" + b"\x00" * 64)
        for n, data in (extra or {}).items():
            z.writestr(n, data)
    return path


def add_symlink(path: Path, name: str, target: str):
    with zipfile.ZipFile(path, "a") as z:
        zi = zipfile.ZipInfo(name)
        zi.external_attr = (stat.S_IFLNK | 0o777) << 16
        z.writestr(zi, target)
