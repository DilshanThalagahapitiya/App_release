# macOS IPA worker

See [../docs/macos-worker.md](../docs/macos-worker.md).

```bash
cd worker
cp .env.example .env   # fill in PLATFORM_URL + WORKER_TOKEN
python3 -m app.main --health-check
python3 -m app.main            # run the loop (or --once)
python3 -m unittest discover -s tests -v
```
