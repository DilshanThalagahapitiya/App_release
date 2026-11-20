from __future__ import annotations

import logging
import threading

from .api_client import ApiClient, ApiError

log = logging.getLogger("lease")


class LeaseKeeper:
    """Background thread that renews the job lease while a (possibly long) validation runs."""

    def __init__(self, api: ApiClient, job_id: str, lease: str, every: float = 60.0):
        self.api, self.job_id, self.lease, self.every = api, job_id, lease, every
        self._stop = threading.Event()
        self.lost = False
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(self.every):
            try:
                self.api.renew(self.job_id, self.lease)
            except ApiError as e:
                if e.code == "LEASE_LOST":
                    self.lost = True
                    log.error("lease lost for job %s; abandoning", self.job_id)
                    return
                log.warning("lease renewal failed: %s", e)

    def __enter__(self) -> "LeaseKeeper":
        self._t.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._t.join(timeout=5)
