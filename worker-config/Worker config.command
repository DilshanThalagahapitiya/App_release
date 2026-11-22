#!/bin/bash
# Double-click this file to open Worker config (start/stop the validation worker, set the worker key).
cd "$(dirname "$0")" || exit 1
exec python3 server.py --open
