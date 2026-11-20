# Database (Cloudflare D1)

Schema: [`migrations/0001_init.sql`](../migrations/0001_init.sql). IDs are random UUIDs; timestamps are ISO-8601 UTC strings produced by the app; JSON is stored as TEXT. Foreign keys are enforced. **Never edit an applied migration** — add `0002_*.sql` (forward-fix). To undo a bad deploy, restore from a D1 Time Travel bookmark (docs/operations.md) and ship a corrective migration.

| Table | Purpose / notes |
|---|---|
| users | `email` unique+lowercase; `password_hash` (`pbkdf2-sha256$iters$salt$hash`); `is_platform_owner`; lockout counters |
| organisations / organisation_members | tenants; org role ∈ org_admin, project_admin, qa_manager, qa_tester, viewer |
| projects / project_members | `access_policy` (named_users_only \| allow_protected_links); project role |
| upload_sessions / upload_parts | multipart state, pre-allocated `build_id`, idempotency key, expiry |
| builds / build_files | build metadata, `validation_status`, `eligibility_status`, `publish_status`, soft delete; IPA key is never returned by APIs |
| worker_registry / worker_jobs | hashed worker tokens; job lifecycle, lease (hashed token + expiry), attempts, backoff, idempotency key |
| validation_reports | one per (job, attempt) — `UNIQUE(worker_job_id, attempt)`; structured JSON columns + R2 copy |
| distribution_links / distribution_link_members | hashed token, scope, password hash, expiry, max downloads (atomic counter) |
| downloads | events (`page_open`, `manifest_requested`, `download_started`, `download_completed` (reserved), `install_confirmed`); only salted IP hash + coarse UA |
| feedback, feedback_attachments, feedback_comments, feedback_status_history | QA workflow |
| notifications, notification_preferences, email_outbox | in-app + optional email with honest delivery state |
| audit_logs | privileged/security events, salted IP hash |
| login_sessions, invitations, password_resets | hashed tokens only |
| platform_settings, rate_limits | owner-managed settings; fixed-window counters |

Indexes cover FK joins, status filters, `created_at` sorts, token hashes (UNIQUE) and the worker claim path `(status, next_attempt_at)`. Pagination is offset-based with stable `ORDER BY … , id`; lists never load whole tables.

**Retention.** Daily cron: sessions/resets/invitations cleanup; `downloads` (default 180 d) and `audit_logs` (default 365 d) per platform settings; soft-deleted builds purged (DB + R2) after 30 d; orphaned/expired uploads aborted; rate-limit rows pruned.
