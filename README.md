# Release Portal — self-hosted iOS IPA distribution & QA feedback

Upload already-signed `.ipa` files, have a dedicated **macOS worker** inspect them, publish eligible builds behind protected links/QR codes, and collect structured QA feedback. Runs on **Cloudflare** (Workers + D1 + R2 + Queues + Cron + Turnstile); the worker runs on a Mac you control.

> **Honesty rule:** the platform never claims an IPA is installable on any device. Eligibility is derived from evidence the worker actually collected (`codesign`, `security cms`, `Info.plist`), the API re-derives it and keeps the *more conservative* verdict, and anything uncertain is shown as **Needs review**. A QR code only opens a URL. Downloads are not installs. See [docs/apple-distribution.md](docs/apple-distribution.md).

## What's in the box
| Area | Where |
|---|---|
| Next.js 16 app (admin console, customer portal, public install page, REST API `/api/v1`) | `src/` |
| D1 schema + migrations | `migrations/` |
| macOS IPA worker (Python stdlib only), launchd, installer | `worker/` |
| Tests (Vitest, Python unittest, live smoke script) | `tests/`, `worker/tests/`, `scripts/smoke.mjs` |
| Docs | `docs/` |

## Quick start (local)
```bash
npm install --legacy-peer-deps          # see docs/cloudflare-deployment.md for why
cp .dev.vars.example .dev.vars          # set URL_SIGNING_SECRET, BOOTSTRAP_OWNER_*
npm run db:migrate:local                # applies migrations to the LOCAL D1 (never production)
npm run cf:build && npm run dev:worker-api   # full Workers runtime on :8799 (R2/D1/Queues emulated by Miniflare)
# or, UI-only iteration with Next dev server (bindings emulated through OpenNext):
npm run dev                             # http://localhost:3000
```
Sign in with `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` (the Platform Owner is created on the first login attempt and only if none exists). Then: create an organisation → accept the invitation link → create a project → register a worker (Worker & Processing) → run the worker → upload an IPA.

## Commands
| | |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm test` | 66 Vitest unit + integration + security tests (real SQL against the real migrations via an in-memory SQLite shim) |
| `npm run worker:test` | Python worker tests (uses real macOS tooling when run on a Mac) |
| `npm run smoke` | Live HTTP flow against a running instance (upload → worker protocol → publish → link → QR → pages). Uses a **mock worker report**; see the header of `scripts/smoke.mjs` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations (remote = `--env production`; read docs/cloudflare-deployment.md first) |
| `npm run cf:build` / `cf:preview` / `cf:deploy` | OpenNext → Cloudflare |

## Documentation
[architecture](docs/architecture.md) · [database](docs/database.md) · [API](docs/api.md) · [security & threat model](docs/security.md) · [Apple distribution rules](docs/apple-distribution.md) · [Cloudflare deployment](docs/cloudflare-deployment.md) · [macOS worker](docs/macos-worker.md) · [operations](docs/operations.md)

## Known limitations (also listed in docs)
* Password hashing is PBKDF2-HMAC-SHA256 @ 100k iterations (the Workers maximum); Argon2id is not available in the runtime.
* Browser (Playwright) UI end-to-end tests are **not** included; the end-to-end flow is covered at HTTP level (`tests/integration/flow.test.ts`, `scripts/smoke.mjs`).
* Email delivery needs a provider (`EMAIL_*`); without it nothing is sent and the UI says so.
* The worker has been exercised on macOS against synthetic fixtures only — validate with your own signed IPAs before relying on it (see docs/macos-worker.md).
* No malware scanning of attachments (images are content-sniffed and served sandboxed); plug a scanner into `receiveAttachment` if required.
