# REST API (`/api/v1`)

* JSON in/out. Success `{ "data": …, "meta": { "requestId" } }`; error `{ "error": { "code", "message", "details" }, "meta" }`. Codes: `VALIDATION_ERROR 422`, `UNAUTHENTICATED 401`, `INVALID_CREDENTIALS 401`, `FORBIDDEN 403`, `NOT_FOUND 404`, `CONFLICT/INVALID_STATE/LEASE_LOST 409`, `LINK_UNAVAILABLE 410`, `PAYLOAD_TOO_LARGE 413`, `UNSUPPORTED_MEDIA 415`, `RATE_LIMITED 429` (+`Retry-After`).
* **Auth.** Browser: HttpOnly `ipa_session` cookie (SameSite=Lax, Secure on https). Mutating cookie requests must carry a same-origin `Origin` (or `Sec-Fetch-Site: same-origin`) — otherwise `403` (CSRF defence). Worker: `Authorization: Bearer wkr_…`.
* Resources you may not see return **404**, not 403 (no existence oracle). Lists are paginated: `?page=&pageSize=&q=…` → `{ items, page, pageSize, total }`.

## Auth
`POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `POST /auth/forgot-password` · `POST /auth/reset-password` · `POST /auth/accept-invitation` · `GET /auth/turnstile` (public site key only)

## Organisations & members
`GET|POST /organisations` · `GET|PATCH /organisations/:id` · `GET /organisations/:id/members` · `POST /organisations/:id/invitations` · `PATCH|DELETE /organisations/:id/members/:memberId` · `POST /invitations/:id/resend|revoke`

## Projects
`GET|POST /projects` · `GET|PATCH|DELETE /projects/:id` (DELETE = archive) · `GET|POST /projects/:id/members` · `DELETE /projects/:id/members/:memberId`

## Uploads & builds
`POST /projects/:id/upload-sessions` `{filename,sizeBytes,sha256,idempotencyKey?}` → `{id,partSizeBytes,totalParts,uploadedParts[]}`
`PUT /upload-sessions/:id/parts/:n` (raw bytes, exact `Content-Length`) · `POST /upload-sessions/:id/complete` (idempotent) · `GET|DELETE /upload-sessions/:id`
`GET|POST /projects/:id/builds` (POST body `{uploadSessionId, releaseTitle, releaseNotes, internalNotes, distributionMethod, externalInstallUrl, allowDownloadWhenIneligible, …}`) · `GET|PATCH|DELETE /builds/:id` · `POST /builds/:id/{publish,unpublish,archive,revalidate}` · `POST /builds/:id/download` (signed URL for the original IPA, admins only) · `POST /builds/:id/report` (signed URL for raw report JSON) · `GET /builds/:id/validation` · `GET /builds/:id/validation/history`

## Distribution
`GET|POST /builds/:id/distribution-links` · `GET /distribution-links?projectId=` · `GET|PATCH /distribution-links/:id` · `POST /distribution-links/:id/revoke` · `GET /distribution-links/:id/qr?format=svg|png`
Public: `GET /d/:token` (page) · `POST /d/:token/access {password}` · `GET /d/:token/manifest.plist?a=<grant>` · `GET /d/:token/download?a=<grant>` · `POST /d/:token/install-confirmed`

## Feedback
`GET /feedback` · `GET|POST /projects/:id/feedback` · `GET|PATCH /feedback/:id` · `POST /feedback/:id/status` `{status,note}` · `POST /feedback/:id/comments` `{body,visibility}` · `POST /feedback/:id/attachments/upload-session` → `PUT /feedback-attachments/:id/content` (raw) · `GET /feedback-attachments/:id/url`

## Other
`GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all` · `GET|PUT /notifications/preferences` · `GET /audit-logs[?format=csv]` · `GET /overview` · `GET /portal/builds` · `GET /portal/downloads` · `GET|PUT /settings` (PUT: Platform Owner) · `GET /system/health` (minimal when anonymous; details for the Platform Owner) · `GET /files/:signedToken` (private object stream)

## Workers (Platform Owner): `GET|POST /workers` · `DELETE /workers/:id` · `POST /worker-jobs/:id/cancel`
## Worker protocol (`Bearer wkr_…`)
`POST /worker/heartbeat {workerVersion}` · `POST /worker/jobs/claim` → `{job|null}` · `POST /worker/jobs/:id/started|progress|renew-lease|complete|fail` — every call carries `leaseToken`; wrong/expired/foreign lease → `409 LEASE_LOST`; replaying `complete` with the same lease is an idempotent success.

### Example
```bash
curl -X POST https://portal.example.com/api/v1/auth/login -H 'content-type: application/json' \
  -H 'origin: https://portal.example.com' -d '{"email":"a@b.com","password":"…"}' -c jar
curl -b jar https://portal.example.com/api/v1/projects?pageSize=5
```
