# Interactive Simulator Preview (Appetize.io)

Lets clients use an iOS app in the browser, with no UDID, TestFlight or install. A developer uploads a zipped **iOS Simulator** `.app`; the portal checks it, sends it to Appetize, and shares a portal link (`/p/<token>`) that embeds the simulator.

## Setup (once)
1. In Appetize: Organization → API Tokens → create a token (role Developer or Admin).
2. `npx wrangler secret put APPETIZE_API_TOKEN --env production` (paste the token). It is only used by the server (`X-API-KEY`), never sent to the browser, never logged.
3. Apply the migration: `npm run db:migrate:remote`, then deploy.
4. The portal must be on a public **https** address: Appetize downloads the build from a short-lived signed URL.

## Developer workflow
Project → **Simulator previews** → *Upload simulator build* (or choose *Interactive Simulator Preview* on the normal upload page). The page shows the Xcode commands:
```bash
xcodebuild -workspace YourApp.xcworkspace -scheme YourApp -sdk iphonesimulator -configuration Debug -derivedDataPath ./Build build
cd ./Build/Build/Products/Debug-iphonesimulator && ditto -c -k --keepParent YourApp.app YourApp.zip
```
Then open the build → **Simulator preview** tab: status (Pending → Uploading → Processing → Ready), *Open simulator*, *Create client preview link*, *Disable / Delete*, version history.

## How it works
- Validation before upload: ZIP/TAR.GZ only; a device `.ipa` (Payload folder), a device-built `.app`, a missing `.app` or a binary with no arm64/x86_64 slice is rejected with an explanation. ZIPs are fully inspected; TAR.GZ is stream-scanned for the first 24 MB only (larger archives are accepted with a warning and Appetize validates them).
- The archive stays in the portal's normal storage (no second copy). Appetize fetches it by a 2-hour signed URL.
- One Appetize app per build (history preserved). *Update existing app* on upload instead pushes a new version into the same Appetize app (older links then show the newest build).
- Background job: queue message + 5-minute cron. Transient failures (network, 5xx, 429) retry with backoff up to 5 times; auth/validation errors fail immediately with the reason. *Retry* restarts a failed preview.
- Statuses: `pending, uploading, processing, ready, failed, expired, disabled, deleted`.

## Security model
- Appetize public keys are shareable, so the portal enforces access separately: unguessable link tokens (stored hashed), optional password, expiry, revocation, project-member checks, all validated on the server.
- Each Appetize app is created with `referrerHostnamesRestricted` = the portal hostname and `appPermissions.run = public` (portal access is enforced by the portal, not Appetize accounts).
- Disabling, expiring or deleting a preview also disables/deletes the app on Appetize, so a leaked key stops working. Appetize has no signed/private embed tokens, so a key that leaks while the preview is live can only be limited by the hostname restriction.
- Management endpoints require the same roles as other build operations. Another organisation gets `404`.

## Known limits
- Not documented by Appetize and therefore unverified here: upload size limit, rate limits, whether a build is usable the instant the create call returns, and plan limits (apps, minutes). The portal treats a successful create/update response as Ready.
- The app icon cannot be read from a simulator `.app`, so the client page shows the app's initial.
- Supabase free storage caps files at about 50 MB; the portal's max upload size setting also applies.

## Embed vs hosted player (verified with a real Appetize account)
Some Appetize plans do not allow iframes: the embedded player then says "Embeds are not enabled for this app. The app owner must upgrade their plan to enable embeds." Appetize's hosted player (`https://appetize.io/app/<key>`) works on every plan. Settings → **Simulator preview display**:
- **EMBED**: the simulator runs inside the portal page (needs an Appetize plan with embeds).
- **LINK**: the client page shows an *Open interactive preview* button that opens Appetize's player in a new tab. The key is then visible in the URL and the hostname restriction does not apply; disabling, expiring or deleting the preview still stops it on Appetize.
