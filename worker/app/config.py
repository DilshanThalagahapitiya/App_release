from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Tiny .env loader (no dependency). Existing environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Config:
    platform_url: str
    worker_token: str
    worker_name: str
    work_dir: Path
    poll_interval: float
    heartbeat_interval: float
    max_ipa_bytes: int
    max_uncompressed_bytes: int
    max_zip_entries: int
    subprocess_timeout: int
    download_timeout: int
    log_level: str
    log_file: str


def load_config(env_file: str | None = None) -> Config:
    _load_dotenv(Path(env_file or os.environ.get("WORKER_ENV_FILE", Path(__file__).resolve().parent.parent / ".env")))
    url = os.environ.get("PLATFORM_URL", "").rstrip("/")
    if not url.startswith("https://") and not url.startswith("http://localhost") and not url.startswith("http://127.0.0.1"):
        raise SystemExit("PLATFORM_URL must be an https:// URL (http is allowed only for localhost development).")
    token = os.environ.get("WORKER_TOKEN", "")
    if len(token) < 20:
        raise SystemExit("WORKER_TOKEN is missing or too short.")
    return Config(
        platform_url=url,
        worker_token=token,
        worker_name=os.environ.get("WORKER_NAME", "macos-worker"),
        work_dir=Path(os.environ.get("WORK_DIR", "/tmp/ipa-worker")),
        poll_interval=float(os.environ.get("POLL_INTERVAL_SECONDS", "5")),
        heartbeat_interval=float(os.environ.get("HEARTBEAT_INTERVAL_SECONDS", "30")),
        max_ipa_bytes=int(os.environ.get("MAX_IPA_BYTES", str(2 * 1024**3))),
        max_uncompressed_bytes=int(os.environ.get("MAX_UNCOMPRESSED_BYTES", str(8 * 1024**3))),
        max_zip_entries=int(os.environ.get("MAX_ZIP_ENTRIES", "50000")),
        subprocess_timeout=int(os.environ.get("SUBPROCESS_TIMEOUT_SECONDS", "60")),
        download_timeout=int(os.environ.get("DOWNLOAD_TIMEOUT_SECONDS", "1800")),
        log_level=os.environ.get("LOG_LEVEL", "INFO"),
        log_file=os.environ.get("LOG_FILE", ""),
    )
