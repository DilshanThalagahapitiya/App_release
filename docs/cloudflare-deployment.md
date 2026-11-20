# Cloudflare deployment

**Versions used:** Next.js 16.4.x, `@opennextjs/cloudflare` 1.20.x, Wrangler 4.x, Node ≥ 20.9. Install with `npm install --legacy-peer-deps` (OpenNext's peer range lags Next's latest). **Plan:** Workers Paid is recommended — the 10 ms CPU cap on Free is too low for PBKDF2 (100k iterations) and SHA-256 over large uploads, and Queues require a paid plan. R2 and D1 have free tiers. Verify current limits in the Cloudflare docs before go-live; this repo does not assume them.

## 1. Resources (separate dev and prod!)
```bash
npx wrangler d1 create ipa-platform-dev     && npx wrangler d1 create ipa-platform-prod
npx wrangler r2 bucket create ipa-platform-dev && npx wrangler r2 bucket create ipa-platform-prod   # keep PRIVATE: do not enable r2.dev or custom public domains
npx wrangler queues create ipa-platform-notify-dev && npx wrangler queues create ipa-platform-notify-prod
```
Put the returned `database_id`s into `wrangler.jsonc` (top level = dev; `env.production` = prod) and set `APP_URL` for production to your https domain. `ENVIRONMENT`/`APP_URL` are plain vars; everything else is a secret.

## 2. Secrets (production)
```bash
npx wrangler secret put URL_SIGNING_SECRET --env production     # ≥ 32 random bytes, e.g. openssl rand -base64 48 ; rotating it invalidates all links/signed URLs
npx wrangler secret put BOOTSTRAP_OWNER_EMAIL --env production   # used once, on first login attempt, only if no Platform Owner exists
npx wrangler secret put BOOTSTRAP_OWNER_PASSWORD --env production # ≥ 12 chars; change it right after first login, then delete both secrets
# optional
npx wrangler secret put TURNSTILE_SITE_KEY --env production ; npx wrangler secret put TURNSTILE_SECRET_KEY --env production
npx wrangler secret put EMAIL_PROVIDER --env production        # "resend" (others: implement EmailProvider in src/lib/email.ts)
npx wrangler secret put EMAIL_API_KEY --env production ; … EMAIL_FROM_ADDRESS … EMAIL_FROM_NAME
```
Local: `.dev.vars` (git-ignored). `.env.example` lists every name with placeholders only.

## 3. Migrate & deploy
```bash
npm run db:migrate:local                  # dev DB, local emulation
npx wrangler d1 migrations apply ipa-platform-prod --remote --env production
npm run cf:build
npm run cf:deploy          # = build + deploy with --env production (cf:deploy:dev targets the dev resources)
```
`npm run db:migrate:remote` points at `ipa-platform-prod` explicitly; local scripts never touch remote. **Preview:** `npm run cf:preview` (uses local emulated bindings).

## 4. Domain, HTTPS, headers
Workers → Settings → Domains & Routes → add `portal.example.com` (DNS record proxied). Enable *Always Use HTTPS* and TLS ≥ 1.2; HSTS and the other headers are set by the app (`next.config.ts`). OTA installation **requires** a publicly trusted HTTPS certificate on this hostname.

## 5. WAF / rate limiting (do this)
Security → WAF → Rate limiting rules (adjust to your traffic):
| Rule | Match | Limit |
|---|---|---|
| Auth | URI path starts with `/api/v1/auth/` | 20 req / 1 min / IP → block 10 min |
| Upload init | path contains `/upload-sessions` and method POST | 30 / 10 min / IP |
| Public links | path starts with `/d/` | 60 / 1 min / IP |
| Worker API | path starts with `/api/v1/worker/` | 600 / 1 min / IP (allow-list your worker's IP if static) |
Enable the Cloudflare Managed Ruleset + OWASP ruleset. Optionally put **Cloudflare Access** (Zero Trust) in front of `/app/workers*` and `/api/v1/workers*`.
Turnstile: create a widget for your domain, set both keys; sign-in then requires it.

## 6. Cron & queue
`triggers.crons` (`*/5 * * * *` maintenance; `17 3 * * *` retention) and the queue consumer are wired through `src/worker-entry.ts`. Queue + Cron require the paid plan; without a Queue binding emails are delivered inline and retried by cron.

## 7. Monitoring & logs
`observability.enabled` is on; use `npx wrangler tail --env production` and the dashboard Logs. Every response carries `x-request-id`, logged on errors. Alert on: worker offline (Overview/Worker page), failed validations, `/api/v1/system/health` ≠ ok (uptime monitor).

## 8. Rollback
`npx wrangler rollback --env production` (previous Worker version). For data: D1 Time Travel `npx wrangler d1 time-travel restore ipa-platform-prod --timestamp=…` (see operations.md). Schema changes are forward-only — ship a fix migration.
