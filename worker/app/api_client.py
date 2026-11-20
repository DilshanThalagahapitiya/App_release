from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from .auth import auth_headers
from .config import Config

log = logging.getLogger("api")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message = status, code, message

    @property
    def transient(self) -> bool:
        return self.status >= 500 or self.status in (408, 429)


class ApiClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def _request(self, method: str, path: str, body: Optional[dict] = None, retries: int = 4) -> Dict[str, Any]:
        url = f"{self.cfg.platform_url}/api/v1{path}"
        data = json.dumps(body).encode() if body is not None else None
        delay = 1.0
        for attempt in range(retries + 1):
            req = urllib.request.Request(url, data=data, method=method, headers=auth_headers(self.cfg.worker_token))
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return json.loads(resp.read().decode() or "{}").get("data", {})
            except urllib.error.HTTPError as e:
                try:
                    err = json.loads(e.read().decode()).get("error", {})
                except Exception:  # noqa: BLE001
                    err = {}
                api_err = ApiError(e.code, err.get("code", "HTTP_ERROR"), err.get("message", str(e)))
                if not api_err.transient or attempt == retries:
                    raise api_err
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == retries:
                    raise ApiError(0, "NETWORK", str(e))
            log.warning("transient API failure on %s %s; retrying in %.0fs", method, path, delay)
            time.sleep(delay)
            delay = min(delay * 2, 30)
        raise ApiError(0, "NETWORK", "unreachable")

    def heartbeat(self, version: str, tools: Dict[str, bool]) -> Dict[str, Any]:
        return self._request("POST", "/worker/heartbeat", {"workerVersion": version, "tools": tools}, retries=1)

    def claim(self) -> Optional[Dict[str, Any]]:
        return self._request("POST", "/worker/jobs/claim", {}).get("job")

    def started(self, job_id: str, lease: str) -> None:
        self._request("POST", f"/worker/jobs/{job_id}/started", {"leaseToken": lease})

    def progress(self, job_id: str, lease: str, stage: str, percent: int, message: str = "") -> None:
        self._request("POST", f"/worker/jobs/{job_id}/progress", {"leaseToken": lease, "stage": stage, "percent": percent, "message": message[:400]}, retries=1)

    def renew(self, job_id: str, lease: str) -> None:
        self._request("POST", f"/worker/jobs/{job_id}/renew-lease", {"leaseToken": lease}, retries=1)

    def complete(self, job_id: str, lease: str, report: dict) -> Dict[str, Any]:
        return self._request("POST", f"/worker/jobs/{job_id}/complete", {"leaseToken": lease, "report": report})

    def fail(self, job_id: str, lease: str, code: str, message: str, retryable: bool) -> Dict[str, Any]:
        return self._request("POST", f"/worker/jobs/{job_id}/fail", {"leaseToken": lease, "errorCode": code, "message": message[:1800], "retryable": retryable})
