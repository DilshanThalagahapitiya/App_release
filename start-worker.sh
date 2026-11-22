#!/bin/bash
# Runs the validation worker on this Mac against the live (Cloudflare) platform. Ctrl+C to stop.
cd "$(dirname "$0")/worker" || exit 1
[ -f .env ] || { echo "worker/.env is missing (PLATFORM_URL and WORKER_TOKEN)."; exit 1; }
pkill -f -- "-m app.main" 2>/dev/null; sleep 1
echo "Validation worker running. Keep this window open. Ctrl+C to stop."
exec python3 -m app.main
