from __future__ import annotations

import hashlib
import os
import re
import stat
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import List, Optional

APP_RE = re.compile(r"^Payload/([^/]+)\.app/")


class IpaError(Exception):
    """A definitive problem with the package itself (not retryable). `code` always starts with IPA_."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class ArchiveInfo:
    app_dir_name: str  # e.g. "Payload/Foo.app"
    entry_count: int
    uncompressed_bytes: int


def inspect_archive(ipa: Path, max_entries: int, max_uncompressed: int) -> ArchiveInfo:
    """Treat the IPA as hostile: validate ZIP integrity, entry names, sizes and layout WITHOUT extracting anything."""
    if not zipfile.is_zipfile(ipa):
        raise IpaError("IPA_NOT_ZIP", "The file is not a valid ZIP archive.")
    try:
        with zipfile.ZipFile(ipa) as z:
            infos = z.infolist()
            if len(infos) > max_entries:
                raise IpaError("IPA_TOO_MANY_ENTRIES", f"Archive has {len(infos)} entries (limit {max_entries}).")
            total = sum(i.file_size for i in infos)
            if total > max_uncompressed:
                raise IpaError("IPA_TOO_LARGE_UNCOMPRESSED", "Archive expands beyond the permitted size (possible zip bomb).")
            compressed = sum(i.compress_size for i in infos) or 1
            if total / compressed > 1000 and total > 100 * 1024 * 1024:
                raise IpaError("IPA_SUSPICIOUS_RATIO", "Archive compression ratio is implausibly high.")
            apps = set()
            for i in infos:
                _check_member_name(i.filename)
                if _is_symlink(i):
                    target = z.read(i).decode("utf-8", "replace")
                    _check_symlink(i.filename, target)
                m = APP_RE.match(i.filename)
                if m:
                    apps.add(m.group(1))
            bad = z.testzip()
            if bad:
                raise IpaError("IPA_CORRUPT", f"ZIP integrity check failed at entry {bad!r}.")
    except zipfile.BadZipFile as e:
        raise IpaError("IPA_CORRUPT", f"Corrupt ZIP archive: {e}")
    if len(apps) != 1:
        raise IpaError("IPA_STRUCTURE_INVALID", "Expected exactly one Payload/<name>.app bundle" + (f", found {len(apps)}." if apps else "."))
    return ArchiveInfo(f"Payload/{next(iter(apps))}.app", len(infos), total)


def _check_member_name(name: str) -> None:
    p = PurePosixPath(name)
    if name.startswith("/") or ".." in p.parts or "\\" in name or "\x00" in name:
        raise IpaError("IPA_PATH_TRAVERSAL", f"Unsafe path in archive: {name[:80]!r}")


def _is_symlink(i: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(i.external_attr >> 16)


def _check_symlink(name: str, target: str) -> None:
    base = PurePosixPath(name).parent
    resolved = os.path.normpath(str(base / target))
    if target.startswith("/") or resolved.startswith("..") or not resolved.startswith("Payload"):
        raise IpaError("IPA_UNSAFE_SYMLINK", f"Symlink {name[:80]!r} points outside the app bundle.")


def read_member(ipa: Path, member: str, limit: int = 20 * 1024 * 1024) -> Optional[bytes]:
    with zipfile.ZipFile(ipa) as z:
        try:
            info = z.getinfo(member)
        except KeyError:
            return None
        if info.file_size > limit:
            raise IpaError("IPA_MEMBER_TOO_LARGE", f"{member} is larger than {limit} bytes.")
        return z.read(info)


def extract_for_codesign(ipa: Path, dest: Path, timeout: int) -> Path:
    """Extract with the system `unzip` (preserves symlinks, which signature sealing depends on).
    Names/symlinks were validated by inspect_archive(). Nothing in the extracted tree is ever executed."""
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(["/usr/bin/unzip", "-q", "-o", str(ipa), "-d", str(dest)], check=True, timeout=timeout, stdin=subprocess.DEVNULL, capture_output=True)
    apps: List[Path] = list((dest / "Payload").glob("*.app"))
    if len(apps) != 1:
        raise IpaError("IPA_STRUCTURE_INVALID", "Extraction did not yield exactly one .app bundle.")
    return apps[0]
