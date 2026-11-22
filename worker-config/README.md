# Worker config

A small web app that runs on your Mac. Use it to start and stop the validation worker and to set the worker key.
It needs nothing installed beyond the Python 3 that already ships with your Mac.

**Open it:** double-click `Worker config.command` (or run `python3 worker-config/server.py --open`). Your browser opens `http://127.0.0.1:8765`. Keep the Terminal window open while you use it. Closing it does not stop the worker.

- **Start / Stop / Restart:** controls the worker process (`python3 -m app.main` in `worker/`). Stop lets it finish the job in progress.
- **Test connection:** checks the address and key against the platform.
- **Worker key:** paste the address and the key (`wkr_…`) from the website (Worker & Processing → Register worker). They are saved in `worker/.env`, readable only by you. The key is never shown back in full.
- **Log:** the last lines of `~/Library/Logs/CredeWorker/worker.log`.

Safety: it listens on `127.0.0.1` only, checks the Host header, and every request carries a random token that only the page it served knows, so other websites cannot control it.

You only need the worker running when the platform's validation mode is **ON** (full Mac validation). In **CLOUD** mode no worker is needed.
