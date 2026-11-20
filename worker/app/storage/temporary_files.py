from __future__ import annotations

import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


@contextmanager
def job_workspace(root: Path) -> Iterator[Path]:
    """Private (0700) per-job directory, always removed — including on failure or exception."""
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    path = Path(tempfile.mkdtemp(prefix="job-", dir=str(root)))
    os.chmod(path, 0o700)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
