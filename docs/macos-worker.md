# macOS IPA worker

Python 3.9+ **standard library only** (system `/usr/bin/python3` on macOS works). Tools used: `/usr/bin/unzip`, `/usr/bin/security`, `codesign` (Xcode Command Line Tools: `xcode-select --install`). Missing tools are detected and reported in the job report and heartbeat; the build then cannot become *Eligible*.

## What it does per job
1 download via signed URL (size-capped) → 2 re-check size & SHA-256 → 3 ZIP integrity, entry-count/size/ratio limits, path-traversal & symlink-escape rejection, exactly one `Payload/*.app` → 4 `Info.plist` (identifier, name, versions, MinimumOSVersion, UIDeviceFamily) → 5 Mach-O header architectures (header bytes only; **nothing is executed**) → 6 extract with `unzip` into a private temp dir; `codesign --verify --deep --strict`, `codesign -dvv` (authority/team), entitlements → 7 `security cms -D` on `embedded.mobileprovision` → profile type/expiry/team/app-id/**device count** (UDIDs dropped) → 8 eligibility (same rules as `src/lib/eligibility.ts`) → 9 report posted; temp dir deleted (also on failure). It never modifies or re-signs the IPA, never logs signed URLs/tokens (redacting formatter), and renews its lease in a background thread. On restart it simply claims again; expired leases are re-queued by the platform.

## Install
1. In the portal (Platform Owner) → **Worker & Processing → Register worker**; copy the one-time token.
2. On the Mac: `git clone` or copy `worker/`, then `sudo ./scripts/install.sh` (creates `_ipaworker` user with no shell, `/usr/local/ipa-worker` (root-owned code), `/var/lib/ipa-worker` (0700 temp), `/var/log/ipa-worker`, newsyslog rotation, launchd daemon `com.example.ipa-worker`).
3. Edit `/usr/local/ipa-worker/.env` (mode 600): `PLATFORM_URL`, `WORKER_TOKEN`, optional limits.
4. `sudo launchctl kickstart -k system/com.example.ipa-worker`; check **Worker & Processing** shows *online*, or run `./scripts/health_check.sh`.
Rename the launchd label (`com.example.*`) to your reverse-DNS in the plist and installer.

## Config (`.env.example`)
`PLATFORM_URL` (https only; http allowed for localhost), `WORKER_TOKEN`, `WORKER_NAME`, `WORK_DIR`, `POLL_INTERVAL_SECONDS`, `HEARTBEAT_INTERVAL_SECONDS`, `MAX_IPA_BYTES`, `MAX_UNCOMPRESSED_BYTES`, `MAX_ZIP_ENTRIES`, `SUBPROCESS_TIMEOUT_SECONDS`, `DOWNLOAD_TIMEOUT_SECONDS`, `LOG_LEVEL`, `LOG_FILE` (self-rotating 10 MB × 5) — the installer also adds a newsyslog entry for launchd's stdout/stderr logs.

## Commands
`python3 -m app.main` (loop) · `--once` · `--health-check` (exit 0 = config OK and credential accepted) · tests: `python3 -m unittest discover -s tests -v`.

## Troubleshooting
| Symptom | Check |
|---|---|
| Portal says worker offline | `tail /var/log/ipa-worker/launchd.err.log`; run health check; clock skew; firewall to `PLATFORM_URL` |
| Exit code 2 / "credential rejected" | token revoked or mistyped → register a new worker |
| Every build `Needs review` + "signature could not be verified" | `which codesign security`; install Command Line Tools; worker must run on macOS |
| `DOWNLOAD_FAILED` | signed URL expires after 45 min; network/DNS to `APP_URL`; platform `APP_URL` must be the public https host |
| `IPA_*` errors | the package itself is bad (see message in Validation tab) — re-export the IPA |
| Jobs stuck "claimed" | lease expires after 5 min without renewal and is re-queued automatically |
| Disk filling | `WORK_DIR` is cleaned per job; stale `job-*` dirs can only remain after a hard power loss — safe to delete |
Security: the service user has no shell or home; run on a dedicated Mac that holds **no signing identities** — the worker never needs them.

**Testing status:** unit tests use synthetic, clearly-labelled fixtures; the macOS pipeline was exercised against the live platform with an *unsigned* synthetic IPA (verifying codesign/`security` invocation and the not-eligible outcome). Validate with a real Ad Hoc, Enterprise and App Store IPA of your own before relying on the verdicts.
