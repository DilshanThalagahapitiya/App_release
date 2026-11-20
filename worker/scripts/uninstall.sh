#!/bin/bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
PLIST="/Library/LaunchDaemons/com.example.ipa-worker.plist"
launchctl bootout system "$PLIST" 2>/dev/null || true
rm -f "$PLIST" /etc/newsyslog.d/ipa-worker.conf
echo "Service removed. $(printf 'Data in /var/lib/ipa-worker, logs in /var/log/ipa-worker and user _ipaworker were left in place; remove manually if desired.')"
