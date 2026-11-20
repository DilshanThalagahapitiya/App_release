#!/bin/bash
# Stops the local app, the public tunnel and the validation worker.
[ -z "$KEEP_START" ] && pkill -f start-local.sh 2>/dev/null
pkill -f "wrangler dev" 2>/dev/null
pkill -f "workerd" 2>/dev/null
pkill -f cloudflared 2>/dev/null
pkill -f "python3 -m app.main" 2>/dev/null
sleep 1
if pgrep -f "wrangler dev|cloudflared|python3 -m app.main" >/dev/null; then
  echo "Something is still running — run ./stop-local.sh again."
else
  echo "Stopped: app, tunnel and worker are all off. Your data is kept."
fi
