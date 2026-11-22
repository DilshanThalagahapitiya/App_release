# Deploy without a tunnel: Cloudflare Workers + Supabase Storage

**How it fits together**
- The web app and API run on **Cloudflare Workers** (free account, no card). They stay on the same address all the time.
- The database is **Cloudflare D1** (free). It already exists as `ipa-platform-prod`.
- The IPA files and reports are stored in **Supabase Storage** (free, no card), instead of Cloudflare R2, which needs a card.
- Your Mac only runs the validation worker.

Cloudflare account used by this project: `dilshan.thalagahapitiya12@gmail.com` (the account `wrangler` is logged in to).

Limits to know:
- Supabase Free allows files up to about **50 MB**, so larger IPAs are rejected. The Pro plan raises it.
- Free Supabase projects **pause after about 1 week without use**. Open the project once to wake it up.
- The free Workers plan limits CPU time per request. If sign-in fails with a "CPU time" error, you need Workers Paid ($5 a month).
- The app bundle is about 1.6 MB compressed, under the free plan's 3 MB limit.
- Your current local data (projects, builds) does not move. You start clean in the cloud.

---

## A. Supabase (about 5 minutes)

1. Create a project at https://supabase.com. Choose the region closest to your clients.
2. **Storage → New bucket**: name it `ipa-builds`. **Leave "Public bucket" OFF.**
3. **Project Settings → Storage → S3 Connection**:
   - Turn it on.
   - Note the **Endpoint**. It looks like `https://abcdefgh.storage.supabase.co/storage/v1/s3`.
   - Note the **Region**, for example `ap-south-1`.
   - Click **New access key**, then copy the **Access key ID** and the **Secret access key**. The secret is shown once.

**Tell Claude only these three: project ref (the `abcdefgh` part), region, and bucket name.**
**Do not paste the access keys into the chat.** You enter them yourself in step C.

## B. Configure the project (Claude can do this for you)
In `wrangler.jsonc`, under `env.production.vars`, set:
```
"STORAGE_S3_ENDPOINT": "https://<project-ref>.storage.supabase.co/storage/v1/s3",
"STORAGE_S3_REGION": "<region>",
"STORAGE_S3_BUCKET": "ipa-builds",
"APP_URL": "https://ipa-platform-prod.<your-workers-subdomain>.workers.dev"
```
The `APP_URL` is only known after the first deploy (step D). Deploy once, then fix it and deploy again.

## C. Secrets (run in the project folder)
```bash
npx wrangler secret put STORAGE_S3_ACCESS_KEY_ID --env production
npx wrangler secret put STORAGE_S3_SECRET_ACCESS_KEY --env production
openssl rand -base64 48        # copy the output
npx wrangler secret put URL_SIGNING_SECRET --env production        # paste it
npx wrangler secret put BOOTSTRAP_OWNER_EMAIL --env production     # the email you will sign in with
npx wrangler secret put BOOTSTRAP_OWNER_PASSWORD --env production  # at least 12 characters
```

## D. Create tables and deploy
```bash
npm run db:migrate:remote     # creates the tables in Cloudflare D1
npm run cf:deploy             # prints the live address
```
Copy the printed `https://ipa-platform-prod.<name>.workers.dev` into `APP_URL` in `wrangler.jsonc`, then run `npm run cf:deploy` again.
Cloudflare may first ask you to choose a `workers.dev` subdomain. Choose any name.

## E. First login
1. Open the live address and sign in with the bootstrap email and password.
2. Change the password under Profile.
3. Delete the bootstrap secrets:
   ```bash
   npx wrangler secret delete BOOTSTRAP_OWNER_EMAIL --env production
   npx wrangler secret delete BOOTSTRAP_OWNER_PASSWORD --env production
   ```
4. Upload an IPA to test. If the upload fails, check the bucket name and keys.

## F. Validation worker on your Mac
1. In the web app, go to **Worker & Processing → Register worker** and copy the token.
2. In `worker/.env`, set `PLATFORM_URL=<live address>` and `WORKER_TOKEN=<token>`.
3. Run `cd worker && ./scripts/install.sh`. Check that the Overview page shows the worker **Online**.
4. Stop the local app and tunnel with `./stop-local.sh`.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Upload fails: "Storage ... failed (403)" | Wrong access key or secret, or the S3 connection is not enabled in Supabase. |
| "Storage ... failed (404)" | The bucket name in `STORAGE_S3_BUCKET` is wrong, or the bucket does not exist. |
| "Storage ... failed (413)" | The file is larger than Supabase's limit. The free plan allows about 50 MB. |
| Sign-in says "Cross-site request rejected" | `APP_URL` does not exactly match the address in the browser. |
| Overview keeps loading | Check `npx wrangler tail --env production` for errors. |

How it works in code: `src/lib/s3-bucket.ts` implements the storage calls the app needs on top of the S3 API, and `src/lib/env.ts` uses it whenever the `STORAGE_S3_*` settings exist. Locally, without those settings, the app still uses the built-in emulated storage.
