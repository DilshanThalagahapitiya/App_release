from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
from typing import Optional

from . import __version__
from .api_client import ApiClient, ApiError
from .config import load_config
from .ipa.archive import IpaError
from .job_lease import LeaseKeeper
from .job_runner import RetryableError, run_validation, tool_status
from .logging_config import setup_logging

log = logging.getLogger("worker")
_stop = False


def _handle(sig, _frm):  # noqa: ANN001
    global _stop
    _stop = True
    log.info("signal %s received; finishing current job then exiting", sig)


def process_one(api: ApiClient, cfg) -> bool:  # noqa: ANN001
    """Claim and process one job. Returns True if a job was handled."""
    job = api.claim()
    if not job:
        return False
    job_id, lease = job["jobId"], job["leaseToken"]
    log.info("claimed job %s (attempt %s)", job_id, job["attempt"])
    try:
        api.started(job_id, lease)
        with LeaseKeeper(api, job_id, lease) as keeper:
            def progress(stage: str, pct: int, msg: str) -> None:
                if keeper.lost:
                    raise RetryableError("LEASE_LOST", "lease lost")
                api.progress(job_id, lease, stage, pct, msg)

            report = run_validation(job, cfg, progress)
        api.complete(job_id, lease, report)
        log.info("completed job %s (eligibility=%s)", job_id, report["eligibilityStatus"])
    except IpaError as e:  # definitive package problem: do not retry
        log.warning("job %s rejected: %s", job_id, e.code)
        _safe_fail(api, job_id, lease, e.code, e.message, False)
    except RetryableError as e:
        if e.code == "LEASE_LOST":
            return True
        log.warning("job %s transient failure: %s", job_id, e.code)
        _safe_fail(api, job_id, lease, e.code, e.message, True)
    except ApiError as e:
        log.error("API error on job %s: %s", job_id, e)
        if e.code != "LEASE_LOST":
            _safe_fail(api, job_id, lease, "API_ERROR", str(e), True)
    except Exception as e:  # noqa: BLE001
        log.exception("unexpected failure on job %s", job_id)
        _safe_fail(api, job_id, lease, "WORKER_INTERNAL", f"{type(e).__name__}", True)
    return True


def _safe_fail(api: ApiClient, job_id: str, lease: str, code: str, msg: str, retryable: bool) -> None:
    try:
        api.fail(job_id, lease, code, msg, retryable)
    except ApiError as e:
        log.error("could not report failure for %s: %s", job_id, e)


def health_check() -> int:
    """Exit 0 if configuration loads and the platform accepts our credential."""
    try:
        cfg = load_config()
        ApiClient(cfg).heartbeat(__version__, tool_status())
        tools = tool_status()
        missing = [k for k in ("codesign", "security", "unzip") if not tools.get(k)]
        if missing:
            print("WARN missing tools:", ", ".join(missing))
        print("OK")
        return 0
    except (SystemExit, ApiError) as e:
        print("FAIL:", e)
        return 1


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description="iOS IPA validation worker (macOS)")
    ap.add_argument("--once", action="store_true", help="process at most one job then exit")
    ap.add_argument("--health-check", action="store_true")
    args = ap.parse_args(argv)
    if args.health_check:
        return health_check()
    cfg = load_config()
    setup_logging(cfg.log_level, cfg.log_file)
    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)
    api = ApiClient(cfg)
    log.info("worker %s v%s starting (platform=%s)", cfg.worker_name, __version__, cfg.platform_url)
    last_beat = 0.0
    backoff = cfg.poll_interval
    while not _stop:
        try:
            if time.time() - last_beat >= cfg.heartbeat_interval:
                api.heartbeat(__version__, tool_status())
                last_beat = time.time()
            handled = process_one(api, cfg)
            backoff = cfg.poll_interval
            if args.once:
                return 0
            if handled:
                continue
        except ApiError as e:
            log.error("platform unreachable or rejected us: %s", e)
            backoff = min(backoff * 2, 120)
            if e.status == 401:
                log.error("credential rejected (revoked?) — exiting")
                return 2
        time.sleep(backoff)
    return 0


if __name__ == "__main__":
    sys.exit(main())
