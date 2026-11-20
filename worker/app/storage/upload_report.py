from __future__ import annotations

import json
from pathlib import Path


def write_local_copy(report: dict, directory: Path, job_id: str) -> Path:
    """Optional debugging aid (disabled by default): stores the structured report, never the IPA."""
    directory.mkdir(parents=True, exist_ok=True)
    out = directory / f"{job_id}.json"
    out.write_text(json.dumps(report, indent=2))
    return out
