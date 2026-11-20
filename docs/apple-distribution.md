# Apple distribution rules & what this platform does about them

This platform **does not re-sign, patch or modify IPAs** and cannot make an IPA installable. It tells the truth about what the evidence shows.

| Method | What the platform does | What it cannot do |
|---|---|---|
| **Ad Hoc** | OTA (`itms-services`) offered only when: ZIP+structure valid, `codesign --verify --deep --strict` valid, embedded profile present, not expired, App ID matches bundle ID, profile type = ad_hoc (no `ProvisionsAllDevices`, `get-task-allow` false, `ProvisionedDevices` present). Always shows: *installs only on devices whose UDID is in the profile*. Device **count** is reported to admins; UDIDs are never copied anywhere. | Know whether the visitor's device is in the profile; check that Apple trusts/has not revoked the certificate. |
| **Development** | Marked *Eligible with warnings*; OTA is **not** offered (not a distribution method). Download-only if an admin explicitly allows it. | — |
| **Enterprise (ADEP)** | OTA offered with a warning that use is limited to qualifying organisations / internal proprietary use under Apple's current terms. Never presented as public distribution. | Verify the organisation qualifies. |
| **TestFlight** | Stores/links the official invitation/public link you provide (must be `https://`), release notes and instructions. | Process builds or replace TestFlight. |
| **App Store / Unlisted / Custom Apps** | Links to the official destination. | Bypass review/Apple Business Manager. |
| **QR codes** | Encode the protected page URL only. | Bypass signing, provisioning, registration or review. |

**Eligibility states** — `Eligible`, `Eligible with warnings`, `Not eligible`, `Needs review`. Anything unknown (signature not verified, no profile, expiry unreadable, profile type unclear, unexpected bundle ID) is **Needs review** — never inferred from a filename. If the worker is not on macOS (or `codesign`/`security` are missing) the report records `not_performed` and the build cannot become eligible.

**Limitations recorded in every report** (shown in the Validation tab): `codesign` validates sealed-resource integrity, not Apple trust or revocation; the CMS chain inside the profile is not validated against Apple roots; device registration cannot be checked; the app is inspected statically and never executed.

**Download ≠ install.** The platform records `manifest_requested`/`download_started` (a user began) and a user-clicked, self-reported `install_confirmed`. `download_completed` exists in the schema but is intentionally never emitted because a server cannot know the client received the bytes.

**Download-only for ineligible builds** requires an explicit per-build admin opt-in and is labelled "installation is not guaranteed".
