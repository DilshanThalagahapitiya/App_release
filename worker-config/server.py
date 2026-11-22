#!/usr/bin/env python3
"""Worker config: a tiny local web app for this Mac.

Start / stop the IPA validation worker and set its Platform URL and Worker key.
Standard library only. Listens on 127.0.0.1 (this Mac) and nothing else.
"""
import hmac
import http.server
import json
import os
import re
import secrets
import signal
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
WORKER_DIR = HERE.parent / "worker"
ENV_FILE = Path(os.environ.get("WORKER_CONFIG_ENV", str(WORKER_DIR / ".env")))
LOG_DIR = Path(os.environ.get("WORKER_CONFIG_LOGDIR", str(Path.home() / "Library" / "Logs" / "CredeWorker")))
LOG_FILE = LOG_DIR / "worker.log"
PORT = int(os.environ.get("WORKER_CONFIG_PORT", "8765"))
PYTHON = sys.executable or "/usr/bin/python3"
TOKEN = secrets.token_urlsafe(24)  # page-to-API token: other websites cannot read it

STORE_FILE = Path(os.environ.get("WORKER_CONFIG_STORE", str(Path.home() / "Library" / "Application Support" / "CredeWorkerConfig" / "keys.json")))

DEFAULTS = {
    "WORKER_NAME": "my-mac",
    "WORK_DIR": "/tmp/ipa-worker",
    "POLL_INTERVAL_SECONDS": "5",
    "HEARTBEAT_INTERVAL_SECONDS": "30",
    "LOG_LEVEL": "INFO",
}
URL_RE = re.compile(r"^(https://[A-Za-z0-9.-]+(:\d{1,5})?|http://(127\.0\.0\.1|localhost)(:\d{1,5})?)$")
KEY_RE = re.compile(r"^wkr_[A-Za-z0-9_-]{20,200}$")
SECRET_RE = re.compile(r"wkr_[A-Za-z0-9_-]{8,}")


# ------------------------------------------------------------------ config file
def read_env(path: Path = ENV_FILE) -> Dict[str, str]:
    out: Dict[str, str] = {}
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def write_env(updates: Dict[str, str], path: Path = ENV_FILE) -> None:
    """Update keys in place (keeping every other line), create the file if missing, chmod 600."""
    lines: List[str] = []
    try:
        lines = path.read_text().splitlines()
    except FileNotFoundError:
        lines = ["# Written by Worker config. Never commit this file."]
    remaining = dict(updates)
    for i, line in enumerate(lines):
        if "=" in line and not line.lstrip().startswith("#"):
            k = line.split("=", 1)[0].strip()
            if k in remaining:
                lines[i] = f"{k}={remaining.pop(k)}"
    for k, v in remaining.items():
        lines.append(f"{k}={v}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, path)
    os.chmod(path, 0o600)


# ------------------------------------------------------------------ saved keys (one per platform address)
def load_store() -> Dict[str, dict]:
    try:
        data = json.loads(STORE_FILE.read_text())
        return {u: v for u, v in data.items() if isinstance(v, dict) and v.get("key")}
    except (FileNotFoundError, ValueError):
        return {}


def save_store(store: Dict[str, dict]) -> None:
    STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE_FILE.with_name(STORE_FILE.name + ".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(store, f)
    os.replace(tmp, STORE_FILE)
    os.chmod(STORE_FILE, 0o600)


def remember(url: str, key: str) -> None:
    if not url or not key:
        return
    store = load_store()
    if store.get(url, {}).get("key") != key:
        store[url] = {"key": key, "saved": time.strftime("%Y-%m-%d %H:%M")}
        save_store(store)


def forget(url: str) -> bool:
    store = load_store()
    if url in store:
        del store[url]
        save_store(store)
        return True
    return False


def mask(key: str) -> str:
    return key[:8] + "…" + key[-4:] if len(key) > 16 else ("set" if key else "")


def validate(url: Optional[str], key: Optional[str]) -> Tuple[Dict[str, str], Optional[str]]:
    """Returns (updates, error). Empty fields are left unchanged."""
    upd: Dict[str, str] = {}
    if url:
        url = url.strip().rstrip("/")
        if not URL_RE.match(url):
            return {}, "The address must look like https://your-site.workers.dev (no path)."
        upd["PLATFORM_URL"] = url
    if key:
        key = key.strip()
        if not KEY_RE.match(key):
            return {}, "That doesn't look like a worker key. It starts with wkr_ and is shown once when you register a worker."
        upd["WORKER_TOKEN"] = key
    return upd, None


def host_ok(host: Optional[str]) -> bool:
    return (host or "") in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}


# ------------------------------------------------------------------ worker process
def worker_pids() -> List[int]:
    r = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True)
    pids = []
    for line in r.stdout.splitlines():
        pid_s, _, cmd = line.strip().partition(" ")
        cmd = cmd.strip()
        if pid_s.isdigit() and int(pid_s) != os.getpid() and cmd.endswith("-m app.main") and "python" in cmd.lower():
            pids.append(int(pid_s))
    return pids


def uptime(pid: int) -> str:
    r = subprocess.run(["ps", "-o", "etime=", "-p", str(pid)], capture_output=True, text=True)
    return r.stdout.strip()


def start_worker() -> Tuple[bool, str]:
    if worker_pids():
        return True, "The worker is already running."
    cfg = read_env()
    if not cfg.get("PLATFORM_URL") or not cfg.get("WORKER_TOKEN"):
        return False, "Set the Platform URL and the Worker key first."
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if LOG_FILE.exists() and LOG_FILE.stat().st_size > 5 * 1024 * 1024:
        LOG_FILE.rename(LOG_FILE.with_suffix(".old"))
    log = open(LOG_FILE, "ab")
    subprocess.Popen([PYTHON, "-m", "app.main"], cwd=str(WORKER_DIR), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                     start_new_session=True, env={**os.environ, "WORKER_ENV_FILE": str(ENV_FILE)})
    for _ in range(20):
        time.sleep(0.25)
        if worker_pids():
            return True, "Worker started."
    return False, "The worker did not start. See the log below."


def stop_worker() -> Tuple[bool, str]:
    pids = worker_pids()
    if not pids:
        return True, "The worker is not running."
    for p in pids:
        try:
            os.kill(p, signal.SIGTERM)  # lets it finish the current job
        except ProcessLookupError:
            pass
    for _ in range(40):
        time.sleep(0.25)
        if not worker_pids():
            return True, "Worker stopped."
    for p in worker_pids():
        try:
            os.kill(p, signal.SIGKILL)
        except ProcessLookupError:
            pass
    time.sleep(0.5)
    return (not worker_pids()), "Worker stopped (forced)."


def log_tail(lines: int = 60) -> str:
    try:
        with open(LOG_FILE, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 24000))
            text = f.read().decode("utf-8", "replace")
    except FileNotFoundError:
        return ""
    return SECRET_RE.sub("wkr_…", "\n".join(text.splitlines()[-lines:]))


def verify(url: str, key: str, env_file: Optional[Path] = None) -> Tuple[str, str]:
    """Try a key against a platform without touching the saved settings. Returns (state, message); state is ok | rejected | unreachable."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        f = env_file or Path(d) / ".env"
        if env_file is None:
            f.write_text(f"PLATFORM_URL={url}\nWORKER_TOKEN={key}\nWORKER_NAME={DEFAULTS['WORKER_NAME']}\nWORK_DIR={DEFAULTS['WORK_DIR']}\n")
            os.chmod(f, 0o600)
        try:
            r = subprocess.run([PYTHON, "-m", "app.main", "--health-check"], cwd=str(WORKER_DIR), capture_output=True, text=True, timeout=40,
                               env={**os.environ, "WORKER_ENV_FILE": str(f)})
        except subprocess.TimeoutExpired:
            return "unreachable", "Timed out. Check the address and your internet connection."
    out = SECRET_RE.sub("wkr_…", (r.stdout + r.stderr).strip())[-600:]
    if r.returncode == 0 and out.startswith("OK"):
        return "ok", "Connected."
    if "401" in out or "UNAUTHENTICATED" in out or "credential" in out.lower():
        return "rejected", out or "The platform rejected this key."
    return "unreachable", out or "Could not reach the platform."


def test_connection() -> Tuple[bool, str]:
    cfg = read_env()
    if not cfg.get("PLATFORM_URL") or not cfg.get("WORKER_TOKEN"):
        return False, "Set the Platform URL and the Worker key first."
    state, msg = verify(cfg["PLATFORM_URL"], cfg["WORKER_TOKEN"], ENV_FILE)
    return state == "ok", msg


def status() -> dict:
    cfg = read_env()
    remember(cfg.get("PLATFORM_URL", ""), cfg.get("WORKER_TOKEN", ""))  # keep whatever is in use safely remembered
    saved = [{"url": u, "keyPreview": mask(v["key"]), "saved": v.get("saved", ""), "active": u == cfg.get("PLATFORM_URL")} for u, v in sorted(load_store().items())]
    pids = worker_pids()
    return {
        "running": bool(pids), "pids": pids, "uptime": uptime(pids[0]) if pids else "",
        "platformUrl": cfg.get("PLATFORM_URL", ""), "keySet": bool(cfg.get("WORKER_TOKEN")), "keyPreview": mask(cfg.get("WORKER_TOKEN", "")),
        "workerName": cfg.get("WORKER_NAME", DEFAULTS["WORKER_NAME"]), "saved": saved, "log": log_tail(), "logFile": str(LOG_FILE), "configFile": str(ENV_FILE),
    }


# ------------------------------------------------------------------ HTTP
class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "WorkerConfig"

    def log_message(self, *a):  # quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header("content-security-policy", "default-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj).encode())

    def _guard(self) -> bool:
        if not host_ok(self.headers.get("host")):
            self._json(403, {"error": "Bad host."})
            return False
        return True

    def do_GET(self):
        if not self._guard():
            return
        if self.path in ("/", "/index.html"):
            html = (HERE / "index.html").read_text().replace("__TOKEN__", TOKEN)
            return self._send(200, html.encode(), "text/html; charset=utf-8")
        if self.path == "/api/status":
            if not hmac.compare_digest(self.headers.get("x-config-token", ""), TOKEN):
                return self._json(403, {"error": "Forbidden."})
            return self._json(200, status())
        self._json(404, {"error": "Not found."})

    def do_POST(self):
        if not self._guard():
            return
        if not hmac.compare_digest(self.headers.get("x-config-token", ""), TOKEN):
            return self._json(403, {"error": "Forbidden."})
        try:
            n = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(min(n, 4096)) or b"{}")
        except Exception:
            return self._json(400, {"error": "Bad request."})
        if self.path == "/api/config":
            upd, err = validate(body.get("platformUrl"), body.get("workerKey"))
            if err:
                return self._json(400, {"ok": False, "message": err})
            cfg = read_env()
            url = upd.get("PLATFORM_URL") or cfg.get("PLATFORM_URL", "")
            key = upd.get("WORKER_TOKEN")
            if not url:
                return self._json(400, {"ok": False, "message": "Enter the platform address."})
            if key:
                # A new key is checked against the platform first, so a wrong key can never replace a working one.
                state, msg = verify(url, key)
                if state == "rejected":
                    return self._json(400, {"ok": False, "message": f"{url} rejected this key, so nothing was changed. Keys from another site (for example the old local one) will not work here."})
                if state == "unreachable" and not body.get("force"):
                    return self._json(400, {"ok": False, "message": "Could not check the key (" + msg[:120] + "). Nothing was changed."})
                remember(url, key)
            else:
                key = load_store().get(url, {}).get("key") or (cfg.get("WORKER_TOKEN") if url == cfg.get("PLATFORM_URL") else None)
                if not key:
                    return self._json(400, {"ok": False, "message": "No key is saved for that address yet. Paste its key."})
                remember(url, key)
            changed = url != cfg.get("PLATFORM_URL") or key != cfg.get("WORKER_TOKEN")
            if not changed:
                return self._json(200, {"ok": True, "message": "Already using this address and key.", "needsRestart": False})
            out = {"PLATFORM_URL": url, "WORKER_TOKEN": key}
            for k, v in DEFAULTS.items():
                if k not in cfg:
                    out[k] = v
            write_env(out)
            running = bool(worker_pids())
            return self._json(200, {"ok": True, "message": "Saved and verified." + (" Restart the worker to use it." if running else ""), "needsRestart": running})
        if self.path == "/api/forget":
            u = str(body.get("url", ""))
            if u == read_env().get("PLATFORM_URL"):
                return self._json(400, {"ok": False, "message": "That address is in use. Switch to another one first."})
            return self._json(200, {"ok": forget(u), "message": "Forgotten." if u else "Nothing to forget."})
        actions = {"/api/start": start_worker, "/api/stop": stop_worker, "/api/test": test_connection}
        if self.path == "/api/restart":
            stop_worker()
            ok, msg = start_worker()
            return self._json(200, {"ok": ok, "message": msg})
        if self.path in actions:
            ok, msg = actions[self.path]()
            return self._json(200, {"ok": ok, "message": msg})
        self._json(404, {"error": "Not found."})


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    srv = Server(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"Worker config is running at {url}\nKeep this window open while you use it. Press Ctrl+C to quit (the worker keeps running).")
    if "--open" in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
