from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler

# Signed URLs, bearer tokens and lease tokens must never reach logs.
_PATTERNS = [
    (re.compile(r"(https?://[^\s/]+/api/v1/files/)[^\s\"']+"), r"\1<redacted>"),
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]+"), r"\1<redacted>"),
    (re.compile(r"wkr_[A-Za-z0-9_\-]+"), "wkr_<redacted>"),
    (re.compile(r"(?i)(leaseToken[\"']?\s*[:=]\s*[\"']?)[A-Za-z0-9_\-]+"), r"\1<redacted>"),
]


def redact(text: str) -> str:
    for rx, repl in _PATTERNS:
        text = rx.sub(repl, text)
    return text


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def setup_logging(level: str = "INFO", log_file: str = "") -> None:
    fmt = RedactingFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.handlers.clear()
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    root.addHandler(sh)
    if log_file:
        # 10 MB x 5 files; see docs/macos-worker.md for newsyslog alternative.
        fh = RotatingFileHandler(log_file, maxBytes=10 * 1024 * 1024, backupCount=5)
        fh.setFormatter(fmt)
        root.addHandler(fh)
