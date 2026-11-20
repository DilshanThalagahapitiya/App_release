# Operations

## Backups & recovery
* **D1:** Time Travel gives point-in-time restore (check retention for your plan): `npx wrangler d1 time-travel info ipa-platform-prod --env production` then `… restore ipa-platform-prod --timestamp=<ISO>`. Also schedule logical exports: `npx wrangler d1 export ipa-platform-prod --remote --output backup-$(date +%F).sql` (store encrypted, off-Cloudflare).
* **R2:** objects are write-once per id. Enable R2 object versioning/lifecycle if your plan allows, or periodically `rclone sync` the bucket (S3 API token with read-only scope) to a second location. Deleting a build soft-deletes first; hard purge after 30 days.
* **Recovery drill:** restore D1 to a *new* database, point a preview Worker at it, verify sign-in and a build page, then swap bindings.
* **Secrets:** keep `URL_SIGNING_SECRET` in your password manager. Losing/rotating it invalidates all distribution links, signed URLs and in-flight grants (re-create links). Sessions are unaffected.

## Scheduled maintenance (automatic)
Every 5 min: lease recovery, expire/abort stale uploads (multipart aborted), orphan cleanup, pending-attachment cleanup, link-expiry warnings, email retry. Daily 03:17 UTC: rate-limit/session/invite/reset purge, retention of `downloads` and `audit_logs`, hard purge of builds soft-deleted > 30 days. Trigger manually in dev: `curl "http://127.0.0.1:8799/cdn-cgi/handler/scheduled"`.

## Email
Without `EMAIL_*` nothing is sent: notifications record `email_state = not_configured`, invitation links are shown once to the inviting admin, and password-reset emails are not delivered (reset by an operator: create a reset token via SQL or temporarily configure email). Provider: set `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`. Add providers by implementing `EmailProvider` in `src/lib/email.ts` (SMTP is not available from Workers; use an HTTP API).

## Monitoring / incident response
* Watch: `/api/v1/system/health`, Worker error rate, D1/R2 errors, Overview "failed validations", worker heartbeat.
* **Leaked link/QR:** Distribution → Revoke (immediate). **Leaked build:** Archive/Delete (revokes all links). **Leaked signed URL:** expires in ≤ 45 min; rotate `URL_SIGNING_SECRET` to kill all now. **Compromised user:** Members → Deactivate (revokes sessions). **Compromised worker:** Worker & Processing → Revoke, rotate Mac credentials.
* Audit log (Activity page, CSV export) is the source of truth for who did what; IPs are salted hashes.

## Data export / deletion (GDPR-style requests)
```sql
-- export a user's data
SELECT * FROM users WHERE email = ?;  SELECT * FROM feedback WHERE reporter_user_id = ?;  SELECT * FROM notifications WHERE user_id = ?;
-- delete: anonymise rather than cascade-delete audit history
UPDATE users SET email = 'deleted-' || id || '@invalid', display_name = 'Deleted user', password_hash = NULL, status = 'disabled' WHERE id = ?;
DELETE FROM login_sessions WHERE user_id = ?; DELETE FROM notifications WHERE user_id = ?;
```
Remove feedback attachments from R2 by `feedback_attachments.r2_object_key` for the relevant feedback ids.

## Upgrades
Raise Wrangler/OpenNext/Next together, run `npm run test:all`, `npm run cf:build`, `npm run smoke` against `dev:worker-api`, then deploy. Update `compatibility_date` only to a date your installed workerd supports.
