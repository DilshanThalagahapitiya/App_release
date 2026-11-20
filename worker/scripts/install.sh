#!/bin/bash
# Installs the worker as a launchd daemon running as a dedicated, unprivileged macOS user.
# Run with sudo from the worker/ directory. Review before running.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then echo "This installer is for macOS only." >&2; exit 1; fi
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi

SVC_USER="_ipaworker"
INSTALL_DIR="/usr/local/ipa-worker"
DATA_DIR="/var/lib/ipa-worker"
LOG_DIR="/var/log/ipa-worker"
PLIST="/Library/LaunchDaemons/com.example.ipa-worker.plist"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! dscl . -read "/Users/$SVC_USER" >/dev/null 2>&1; then
  UID_NEW=$(( $(dscl . -list /Users UniqueID | awk '{print $2}' | sort -n | awk '$1<500{m=$1} END{print m}') + 1 ))
  dscl . -create "/Users/$SVC_USER"
  dscl . -create "/Users/$SVC_USER" UserShell /usr/bin/false
  dscl . -create "/Users/$SVC_USER" RealName "IPA Worker"
  dscl . -create "/Users/$SVC_USER" UniqueID "$UID_NEW"
  dscl . -create "/Users/$SVC_USER" PrimaryGroupID 20
  dscl . -create "/Users/$SVC_USER" NFSHomeDirectory /var/empty
  echo "Created service user $SVC_USER (uid $UID_NEW)"
fi

mkdir -p "$INSTALL_DIR" "$DATA_DIR/tmp" "$LOG_DIR"
rsync -a --delete --exclude '.env' --exclude '__pycache__' --exclude 'tests' "$SRC_DIR/app" "$INSTALL_DIR/"
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cp "$SRC_DIR/.env.example" "$INSTALL_DIR/.env"
  echo "Edit $INSTALL_DIR/.env and set PLATFORM_URL and WORKER_TOKEN."
fi
chown -R root:wheel "$INSTALL_DIR"; chmod -R go-w "$INSTALL_DIR"
chown "$SVC_USER" "$INSTALL_DIR/.env"; chmod 600 "$INSTALL_DIR/.env"
chown -R "$SVC_USER" "$DATA_DIR" "$LOG_DIR"; chmod 700 "$DATA_DIR" "$DATA_DIR/tmp"

cp "$SRC_DIR/launchd/com.example.ipa-worker.plist" "$PLIST"
chown root:wheel "$PLIST"; chmod 644 "$PLIST"
cat > /etc/newsyslog.d/ipa-worker.conf <<EOF
# logfilename                         [owner:group]   mode count size when flags
$LOG_DIR/launchd.out.log              $SVC_USER:staff 640  7     10240 *    J
$LOG_DIR/launchd.err.log              $SVC_USER:staff 640  7     10240 *    J
EOF
launchctl bootout system "$PLIST" 2>/dev/null || true
launchctl bootstrap system "$PLIST"
echo "Installed. Check: sudo -u $SVC_USER WORKER_ENV_FILE=$INSTALL_DIR/.env /usr/bin/python3 -m app.main --health-check (from $INSTALL_DIR)"
