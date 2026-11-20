# Architecture

```
 Browser (admin / customer / iPhone Safari)
        │ HTTPS  (Cloudflare WAF, rate limiting, Turnstile on sign-in)
        ▼
 ┌──────────────────────── Cloudflare Worker (OpenNext build of Next.js 16) ───────────────────────┐
 │  /app/*  admin console      /portal/*  customer portal      /d/:token  public install page        │
 │  /api/v1/*  REST API  ──►  services/*  ──►  D1 (SQL)   R2 (private objects)   Queue (email)      │
 │  scheduled(): */5 min maintenance + daily retention                                               │
 └───────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲  HTTPS, Bearer worker token (hash stored)          
        │  claim → download via short-lived signed URL → inspect → complete(report)
 ┌───────────────────────── Dedicated macOS machine (launchd, user _ipaworker) ─────────────────────┐
 │  Python worker: zipfile checks · plist · security cms · codesign · Mach-O header                  │
 └───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Key flows
**Upload.** Browser hashes the file (streaming SHA-256), `POST upload-sessions` → R2 *multipart* upload is created through the Worker binding (no S3 credentials exist anywhere). The browser PUTs 32 MiB parts to `/upload-sessions/:id/parts/:n` (each part is one Worker request, so Worker body-size limits are never hit; failed parts are retried and already-stored parts are skipped on resume). `complete` is idempotent: it assembles the object, checks size, ZIP magic and **recomputes SHA-256 in the Worker with `DigestStream`**, deleting the object on any mismatch. Only then `POST /projects/:id/builds` creates the build + a `worker_jobs` row (unique idempotency key → no duplicates).

**Validation.** `claim` is a single `UPDATE … WHERE id = (SELECT … LIMIT 1) RETURNING` (atomic); it returns a random lease token (stored hashed), and a 45-minute HMAC-signed URL for that one build. The worker streams the IPA, re-checks size+SHA-256, inspects it, posts progress (extends the lease) and finally the report. The API validates the report against a versioned Zod schema, re-derives eligibility from the facts and stores the **more conservative** verdict. Reports are unique per `(job, attempt)`. Expired leases are returned to the queue by the claim path and the cron; transient failures back off 30 s → 15 min; `IPA_*` failures are definitive.

**Distribution.** A link's public token is `HMAC(URL_SIGNING_SECRET, "dist-link:" + linkId)`; only its SHA-256 is stored, yet authorised admins can re-display the link/QR. The page (`/d/:token`) resolves access (named users / project members / protected link ± password), logs `page_open`, and decides the install action in `decideInstallAction`: OTA only for validated Ad Hoc/Enterprise, otherwise link-out (TestFlight/App Store), explicit download-only, or **no button + explanation**. OTA needs cookie-less fetches by iOS, so the page embeds a 15-minute signed *grant* in the manifest URL; the manifest embeds a 10-minute signed IPA URL. Events: `page_open`, `manifest_requested` (counts toward `max_downloads`), `download_started`, and self-reported `install_confirmed`. No event is treated as proof of installation.

**Feedback.** Testers file reports (+ image attachments verified by magic bytes, stored privately, served through 5-minute signed URLs with `nosniff`, `attachment`/sandbox CSP). Staff triage with an enforced state machine; customer-visible vs internal comments; status history; notifications.

## Code map
`src/lib` pure/shared logic (permissions, eligibility, rules, crypto, schemas) · `src/services` business logic with all SQL · `src/app/api/v1` thin route handlers wrapped by `api()` (auth, CSRF origin check, rate-limit, Zod, error envelope) · `src/components` UI kit and features · `src/worker-entry.ts` fetch + scheduled + queue handlers.

## Assumptions
* One Cloudflare account hosts D1/R2/Queues/Worker; a second (dev) set of resources is used for local/preview.
* Email is optional. With no provider, invitation links are returned once to the inviting admin.
* Next.js 16.4 + `@opennextjs/cloudflare` 1.20 + Wrangler 4 (see package.json). `compatibility_date` is set to a date supported by the installed workerd; raise it with Wrangler upgrades.
