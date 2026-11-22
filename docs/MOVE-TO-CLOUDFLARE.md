# Move from the local tunnel to real Cloudflare hosting

Goal: the platform runs on Cloudflare 24/7 with a **permanent HTTPS address**. No tunnel, and your Mac does not need to stay on for clients to install. Only the validation worker keeps running on your Mac.

> **No card? Use [DEPLOY-SUPABASE.md](DEPLOY-SUPABASE.md) instead**: it stores files in Supabase and skips R2.
>
> Allow about 30–45 minutes. The commands below are in the order you run them. Run them in the project folder (`App_release`), not in `worker/`.

---

## 0. Read this first (honest limits)

| Topic | What you need to know |
|---|---|
| **R2 needs a payment method** | File storage (R2) cannot be switched on without a card on the Cloudflare account. Everything else (Workers, D1, Queues, Cron) works on the free plan. **If you cannot add a card, stop here:** the app needs a code change to store files somewhere else (for example Supabase Storage). Ask Claude to build that first. |
| **Free Workers plan may be too small** | The app bundle is about 1.6 MB compressed, which fits the free 3 MB limit. Logins use a heavy password hash that can exceed the free CPU limit. If sign-in fails with a "CPU time" error, the **Workers Paid plan ($5 a month)** fixes it. Try the free plan first. |
| **Your data does not move automatically** | The local database and uploaded IPAs stay on your Mac. On Cloudflare you start clean: new owner login, new projects, and you upload IPAs again. |
| **Old links stop working** | Tunnel links, install links and UDID request links all die when you switch. Create them again on the new address. |
| **UDID profile** | Cloudflare gives a trusted HTTPS certificate, so iOS accepts it exactly as before. The profile still shows "Not Signed", which is normal. |

---

## 1. Create a Cloudflare account and log in

1. Make sure you have a Cloudflare account. Add a payment method under **Billing**. This is needed for R2, and for the Paid Workers plan if you choose it.
2. In Terminal:
   ```bash
   cd ~/Documents/GitHub/App_release
   npx wrangler login
   npx wrangler whoami
   ```
   The browser opens. Click **Allow**. `whoami` should list your account.

## 2. Turn on R2 (file storage)

1. Cloudflare dashboard → **Storage & databases → R2 object storage** → **Purchase R2 / Enable**.
2. R2's free tier (10 GB) is enough. You are only asked for the card.

## 3. Create the resources

```bash
npx wrangler r2 bucket create ipa-platform-prod
npx wrangler queues create ipa-platform-notify-prod
```

- If it says **"already exists"** or **"already taken"** for the queue, that is fine. It exists from before.
- The production database was already created. Its ID `97d4e150-b455-4929-98e5-dbb35567198c` is in `wrangler.jsonc`. If `wrangler d1 list` does not show `ipa-platform-prod`, run `npx wrangler d1 create ipa-platform-prod` and paste the new `database_id` into `wrangler.jsonc` under `env.production`.
- **Keep the bucket private.** Do not turn on "Public access" or `r2.dev`.

## 4. Choose the address (APP_URL)

You have two options:

- **A. Free `workers.dev` address (easiest).** After the first deploy Cloudflare shows something like `https://ipa-platform-prod.<your-name>.workers.dev`. Use that.
- **B. Your own domain** (for example `portal.yourcompany.com`), if the domain is on Cloudflare.

Open `wrangler.jsonc` and, under `env.production.vars`, replace

```jsonc
"APP_URL": "https://REPLACE-WITH-YOUR-DOMAIN"
```

with the real address, with no trailing slash. For option A you do not know it yet:

1. Do step 5 and step 6 once.
2. Copy the printed address.
3. Put it into `APP_URL`.
4. Run `npm run cf:deploy` again.

Both URLs must match exactly, or sign-in fails with "Cross-site request rejected".

## 5. Set the secrets (once)

Run each command and paste the value when it asks:

```bash
openssl rand -base64 48        # prints a long random string; copy it
npx wrangler secret put URL_SIGNING_SECRET --env production        # paste that string
npx wrangler secret put BOOTSTRAP_OWNER_EMAIL --env production     # your own email, used to log in
npx wrangler secret put BOOTSTRAP_OWNER_PASSWORD --env production  # at least 12 characters; write it down
```

- Do **not** reuse the secret from `.dev.vars`.
- Never change `URL_SIGNING_SECRET` afterwards. It would break every link.

## 6. Create the database tables and deploy

```bash
npm install --legacy-peer-deps
npm run db:migrate:remote      # type "y" when asked; creates all tables including devices
npm run cf:deploy              # builds and uploads the app
```

When it finishes it prints the live address (option A). Open it in a browser.

If the deploy fails:

| Error | Fix |
|---|---|
| "Script size exceeds the limit" | Upgrade to Workers Paid (Dashboard → Workers & Pages → Plans), then deploy again. |
| "R2 bucket not found" | Redo step 2 and step 3. |
| "Queue not found" | `npx wrangler queues create ipa-platform-notify-prod` |
| "CPU time limit" at login | Upgrade to Workers Paid. |

## 7. First login

1. Open the live address → **Sign in**.
2. Use the email and password from step 5. The first sign-in creates the owner account.
3. Go to **Profile → change password**.
4. Delete the two bootstrap secrets, which are no longer needed:
   ```bash
   npx wrangler secret delete BOOTSTRAP_OWNER_EMAIL --env production
   npx wrangler secret delete BOOTSTRAP_OWNER_PASSWORD --env production
   ```
5. Create your organisation, project and (if needed) members again.

## 8. Point the validation worker (your Mac) at Cloudflare

The worker still runs on your Mac, but now talks to the cloud instead of the tunnel.

1. In the web app: **Worker & Processing → Register worker**. Name it `my-mac` and **copy the token**. It is shown only once.
2. In `worker/.env` (create it from `worker/.env.example` if missing) set:
   ```
   PLATFORM_URL=https://YOUR-LIVE-ADDRESS
   WORKER_TOKEN=the-token-you-copied
   ```
3. Start it: `cd worker && ./scripts/install.sh`. This keeps it running after restarts. Or run `python3 -m app.main` inside `worker/`.
4. Within a minute **Worker status** on the Overview page should say **Online**.

Stop the old local worker and tunnel (`./stop-local.sh`). Do not run both against the same data.

## 9. Test everything once

1. Upload your IPA. Wait for **Eligible** and click **Publish**.
2. Open the **Distribution** tab → create an install link → open it on an iPhone. It must start with `https://`.
3. **Devices (UDIDs)** tab → **New request link** → open it in Safari on a phone → check the device appears.

## 10. Day-to-day

| Task | Command |
|---|---|
| Deploy a new version of the platform | `npm run cf:deploy` |
| See live logs | `npm run cf:logs` |
| Roll back a bad deploy | `npx wrangler rollback --env production` |
| Update the database after a new migration | `npm run db:migrate:remote` |

## 11. Recommended security steps (10 minutes)

- Cloudflare dashboard → **Security → WAF → Rate limiting**: limit `/api/v1/auth/` to 20 requests per minute per IP. More rules are in `docs/cloudflare-deployment.md` section 5.
- Dashboard → **SSL/TLS** → turn on **Always Use HTTPS**.
- Optional: create a **Turnstile** widget and set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` as secrets, so sign-in shows a bot check.

## Quick checklist

- [ ] `wrangler login` works
- [ ] R2 enabled, bucket `ipa-platform-prod` created
- [ ] Queue `ipa-platform-notify-prod` exists
- [ ] `APP_URL` set to the real address in `wrangler.jsonc`
- [ ] 3 secrets set
- [ ] `npm run db:migrate:remote` done
- [ ] `npm run cf:deploy` done
- [ ] Logged in, password changed, bootstrap secrets deleted
- [ ] Worker registered and **Online**
- [ ] Test upload, install link and UDID link work

More detail: [cloudflare-deployment.md](cloudflare-deployment.md), [macos-worker.md](macos-worker.md), [operations.md](operations.md).
