#!/bin/bash
# Exit 0 when the worker can load its config and authenticate to the platform.
cd /usr/local/ipa-worker 2>/dev/null || cd "$(dirname "$0")/.."
exec /usr/bin/python3 -m app.main --health-check
