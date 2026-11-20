# Security

## Controls
* **AuthN:** email+password, PBKDF2-HMAC-SHA256 100k iterations with 16-byte random salt (Workers' max; Argon2id unavailable natively — upgrade path: versioned hash string + rehash-on-login). Generic failure message, constant-time-ish verification for unknown users, lockout after 5 failures (15 min), D1 throttles per IP and per email, Turnstile on sign-in/forgot-password when configured. Sessions: 256-bit random token, only SHA-256 stored, HttpOnly/SameSite=Lax/Secure cookie, 14-day absolute expiry, revocable; password reset and member deactivation revoke sessions. No tokens in localStorage.
* **CSRF:** cookie-authenticated mutations require same-origin `Origin`/`Sec-Fetch-Site`; plus SameSite=Lax.
* **AuthZ:** every query is routed through `src/lib/access.ts` loaders that scope by organisation membership **and** project membership; unauthorised resources are 404. Pure permission matrix below, enforced server-side and unit-tested; the UI only hides things cosmetically.
* **Tokens:** invitations, resets, sessions, worker tokens and distribution tokens are random ≥ 128-bit (usually 256) and stored only as SHA-256 hashes. Distribution tokens are HMAC-derived (see architecture) — rotating `URL_SIGNING_SECRET` invalidates all links and signed URLs.
* **Files:** R2 buckets are private; keys are server-generated ids; downloads happen only via HMAC-signed, short-lived (5–45 min) URLs naming a DB record (never a key) after an authorisation check; responses carry `Content-Disposition: attachment` (images inline but sandboxed), `nosniff`, `Cache-Control: private, no-store`, restrictive CSP. Attachments are image-only, size-capped and verified by magic bytes. IPA uploads are verified for size, ZIP magic and SHA-256.
* **Worker:** unique revocable token; atomic claim; hashed lease token with expiry; stale/foreign/replayed updates rejected; report schema-validated; API keeps the more conservative eligibility. The worker treats the IPA as hostile: entry/size/ratio limits, path-traversal and symlink-escape rejection, extraction only into a private 0700 temp dir that is always deleted, subprocess timeouts, never executes IPA contents, redacts signed URLs/tokens from logs, runs as an unprivileged user.
* **Headers:** CSP (self + Turnstile), `X-Frame-Options: DENY`, `nosniff`, HSTS, Referrer-Policy, Permissions-Policy; protected routes `Cache-Control: private, no-store`.
* **Privacy:** raw IPs are never stored (salted hash only), UDIDs from the provisioning profile are stored in the validation report and shown to project staff only, audit metadata excludes secrets.
* **SQL:** all queries use bound parameters; dynamic identifiers come from allow-lists; LIKE input is escaped. **XSS:** React escaping, no `dangerouslySetInnerHTML` except the server-generated QR SVG; manifest XML escaped.
* **Cloudflare layer (configure!):** WAF managed rules; rate-limit rules for `/api/v1/auth/*`, `/api/v1/*/upload-sessions`, `/d/*`, `/api/v1/worker/*` (examples in cloudflare-deployment.md); optional Cloudflare Access in front of `/app/workers` and `/api/v1/workers`.

## Threat model (summary)
| Threat | Mitigation |
|---|---|
| Account takeover | hashing, lockout, throttling, Turnstile, session revocation, generic errors |
| Tenant leakage / IDOR | central scoped loaders, 404-on-unauthorised, isolation tests |
| Token guessing / leaked link or QR | 256-bit tokens, hashed storage, expiry/max downloads/revoke, optional password, named-user scopes; leaked protected link ⇒ revoke |
| Malicious IPA/archive | zip bomb/ratio/entry limits, traversal & symlink checks, no execution, sandboxed user |
| Path traversal | object keys from ids only; archive names validated |
| Oversized upload | declared-size cap, exact part sizes, size re-check on assembly |
| Worker impersonation / replay | token hash + revocation, lease token hash, expiry, ownership, idempotent complete |
| Signed-URL leakage | ≤ 45 min (build, worker) / 10 min (OTA) / 5 min (attachment, admin IPA) lifetimes, bound to one record; revoke by rotating secret |
| XSS / CSRF / SQLi | see above |
| DoS | WAF + D1 limiter + Workers platform limits; multipart parts bounded to 32 MiB |

## Residual risks / honest gaps
Password hashing strength is below Argon2id; the D1 rate limiter is a safety net not a DDoS shield; no antivirus scanning; a leaked *unprotected* distribution link works until revoked/expired; a compromised Platform Owner can register workers; a compromised worker can lie about *facts* (the API only catches inconsistencies) — keep it hardened.

## Permission matrix (effective project role × action)
| action | owner/org_admin | project_admin | qa_manager | qa_tester | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| project:view | ✓ | ✓ | ✓ | ✓ | ✓ |
| project:update / members:manage | ✓ | ✓ | | | |
| project:delete | ✓ | | | | |
| build:view | ✓ | ✓ | ✓ | ✓ (published) | ✓ (published) |
| build:view_internal (internal notes, validation) | ✓ | ✓ | ✓ | | |
| build:upload / update / publish / archive / revalidate / download_ipa | ✓ | ✓ | | | |
| build:delete | ✓ | ✓ | | | |
| distribution:manage | ✓ | ✓ | | | |
| feedback:create | ✓ | ✓ | ✓ | ✓ | |
| feedback:view_all | ✓ | ✓ | ✓ | | ✓ |
| feedback:view_own | ✓ | ✓ | ✓ | ✓ | |
| feedback:manage / comment_internal | ✓ | ✓ | ✓ | | |
Org-level: `org_admin` manages members/invitations/org settings; Platform Owner additionally creates organisations, registers/revokes workers, edits platform settings. The matrix is generated from `src/lib/permissions.ts` and asserted in `tests/unit/core.test.ts`.

## Data export & deletion
Per-user export/deletion is operator-run SQL (docs/operations.md). Organisation deletion = set `status='archived'`, then purge with the documented statements.
