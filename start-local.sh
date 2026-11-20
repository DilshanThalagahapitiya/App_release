#!/bin/bash
# One-command local start: free HTTPS tunnel + the app. Press Ctrl+C to stop everything.
cd "$(dirname "$0")"
set -e

# 1. First-run setup (secret + owner login) — only if not done yet
if ! grep -q '^URL_SIGNING_SECRET=.\{20,\}' .dev.vars 2>/dev/null; then
  PASS=$(openssl rand -base64 12 | tr -d '/+=')
  cat > .dev.vars <<VARS
APP_URL=http://127.0.0.1:8799
ENVIRONMENT=development
URL_SIGNING_SECRET=$(openssl rand -base64 48 | tr -d '\n')
BOOTSTRAP_OWNER_EMAIL=owner@example.com
BOOTSTRAP_OWNER_PASSWORD=${PASS}A1
VARS
  echo "$PASS"A1 > .owner-password.txt
fi

# 2. Database + build
npm run db:migrate:local >/dev/null
[ -d .open-next ] || npm run cf:build

# 3. Start the tunnel and read its address
rm -f /tmp/tunnel.log
cloudflared tunnel --url http://127.0.0.1:8799 > /tmp/tunnel.log 2>&1 &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null; kill $APP 2>/dev/null' EXIT INT TERM
for i in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/tunnel.log | head -1 || true)
  [ -n "$URL" ] && break; sleep 1
done
[ -z "$URL" ] && { echo "Could not start the tunnel. See /tmp/tunnel.log"; exit 1; }

# 4. Point the app at the tunnel address and rebuild-free restart
sed -i '' "s|^APP_URL=.*|APP_URL=$URL|" .dev.vars
echo ""
echo "=============================================="
echo "  OPEN THIS:   $URL"
echo "  Email:       owner@example.com"
echo "  Password:    $(cat .owner-password.txt 2>/dev/null || echo '(see .dev.vars)')"
echo "=============================================="
echo "Keep this window open. Press Ctrl+C to stop."
npx wrangler dev --port 8799 --ip 127.0.0.1 &
APP=$!
wait $APP
