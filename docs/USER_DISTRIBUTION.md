# Distributing My Budget to End Users

How to get the app (and the [User Manual](USER_MANUAL.md)) into people's hands, what each channel costs, and which to start with.

## Recommendation in one paragraph

**Start with the web app at https://prapanji.in as the single, primary channel** — it is already built, deployed by the CI/CD pipeline, works on every phone and computer with nothing to install, and updates for everyone the moment you deploy. Hand out the link plus the User Manual. **Add an Android APK** (EAS internal distribution) only when a group asks for a home-screen app. **Move to Google Play / TestFlight** once you have more than a few dozen users or want automatic store updates. This order keeps cost and support effort near zero until demand proves otherwise.

---

## 1. Channels compared

| Channel | What the user does | Cost | Effort for you | Updates | Best for | Status in this repo |
|---|---|---|---|---|---|---|
| **A. Web app** `https://prapanji.in` | open the link; optionally "Add to Home Screen" | none beyond hosting (~US$20/mo total) | none per user | instant, for everyone, on each deploy | everyone, day one | ✅ ready (Dockerfile → nginx; Caddy TLS) |
| **B. Android APK, direct** (EAS `preview` profile → internal distribution) | open a build link / scan a QR on the phone, allow "install unknown apps", install | EAS free tier has limited builds; paid plans optional | one `eas build` per release; re-send link | manual — users install each new APK | pilot groups, family & friends, offices | ⚠ profile exists (`eas.json`) but needs the API URL set — see §4 |
| **C. Google Play** (internal testing → closed → production) | install from Play Store | one-time developer fee (about US$25) | store listing, privacy policy, review | automatic via Play | public Android release | not started |
| **D. iOS via TestFlight / App Store** | install TestFlight, then the app | Apple Developer Program (about US$99/yr) + a Mac-less cloud build via EAS | certificates, review | via TestFlight / store | iPhone users | not started; bundle id `com.rangnenwars.mybudget` is set in `app.json` |
| **E. Shared-link + QR poster / message** | scan | none | none | n/a | onboarding for A–D | document only |

Verify current prices and store policies before committing; they change.

---

## 2. Channel A — the web app (do this first)

**Why it fits:** the app is online-only and already a responsive web build. Nothing is stored on the device except the sign-in token, so there is no offline gap that a native app would close.

**Onboard a user in four steps** (this is the message you send):

1. Open **https://prapanji.in** on your phone or computer.
2. Tap **Create an account**, use your email and a password of 8+ characters.
3. Open the confirmation email and tap the link.
4. Optional: add it to your home screen — *Android Chrome:* ⋮ → **Add to Home screen** · *iPhone Safari:* Share → **Add to Home Screen**. (This is a shortcut to the website, not an offline app.)

**Message template (WhatsApp / email):**

> Hi! I've set up *My Budget* — a simple app to track income, expenses, loans, investments and savings goals in ₹.
> 👉 https://prapanji.in  (works on any phone or computer)
> Create an account with your email, then confirm the email we send. Guide: <link to USER_MANUAL — see §5>.
> Stuck? Use the little 🐞 icon on the dashboard to report a problem, or reply to me.

**Access control — read this.** Registration is **open**: anyone who knows the URL can sign up. There is no invitation-code feature today. If the audience is closed (family, a team):
* share the link only with them;
* watch signups: `SELECT email, created_at FROM users ORDER BY id DESC LIMIT 20;` ([DB_ADMIN_QUERIES §1](DB_ADMIN_QUERIES.md#1-look-at-users)) and **deactivate** strangers from the Admin screen;
* if you need a hard gate, add an invite-code check to `POST /auth/register` (`server/src/routes/auth.ts`) — a small, well-contained change — or put HTTP basic auth on the site in `deploy/Caddyfile`.

**Pro:** in production nobody can grant themselves Pro. After a user signs up, an admin opens **Admin → Users → user → Tier → Pro** (or see DB_ADMIN_QUERIES §3). Decide upfront who gets Pro (everyone / paying / nobody) and tell users.

**Prerequisite checklist before inviting anyone** (see [CONFIGURATION_STATE.md](CONFIGURATION_STATE.md) §2):
* [ ] `https://prapanji.in` loads with a valid certificate; `/health` is OK
* [ ] An admin account exists and demo accounts do **not**
* [ ] **SMTP configured** — otherwise users never receive the confirmation / password-reset emails (the app still works, but "Forgot password" will be dead and you'll be resetting passwords by hand)
* [ ] Nightly backup running and a restore tested
* [ ] Uptime alert pointing at you

---

## 3. Channels B–D — native apps (when you need them)

> **Project rule:** `AGENTS.md` requires reading the Expo **v57** docs (https://docs.expo.dev/versions/v57.0.0/ and the EAS docs) before touching client build configuration. The commands below are the standard EAS flow; confirm flags against those docs.

### 3.1 Prerequisites (all native channels)

1. An Expo account; `npx eas-cli login` (interactive — you must run it).
2. `app.json` already defines the name *My Budget*, slug `mybudgetapp`, Android package and iOS bundle id `com.rangnenwars.mybudget`, icons and the dark theme.
3. **The API URL must be baked into the build.** Native bundles read `EXPO_PUBLIC_API_URL` at build time, and `utils/api.ts` falls back to `http://localhost:4000/api/v1` — a build without it **cannot reach production**. `eas.json` currently sets no environment in any profile. Add it before building anything distributable:

   ```json
   "build": {
     "preview":    { "distribution": "internal", "android": { "buildType": "apk" },
                     "env": { "EXPO_PUBLIC_API_URL": "https://prapanji.in/api/v1" } },
     "production": { "autoIncrement": true,
                     "env": { "EXPO_PUBLIC_API_URL": "https://prapanji.in/api/v1" } }
   }
   ```
4. Native apps send no browser `Origin`, so `CORS_ORIGIN` does not block them; the server needs no change.
5. Sign-in tokens live in the OS keychain/keystore (`expo-secure-store`), not in browser storage.
6. Links in password-reset / confirmation emails open the **web** page (`APP_URL`), so those two flows finish in the browser even for app users. That's expected.

### 3.2 Channel B — Android APK for a pilot group

```bash
npx eas-cli build --platform android --profile preview     # builds an installable .apk in the cloud
```

EAS returns a build page with an install link and QR code. Send it to testers; they open it on the phone, allow installing from that source, and install. Re-run the command for each release and resend the new link (APK updates are manual). Keep the version in `app.json` (`version`) in step with what you tell users.

### 3.3 Channel C — Google Play

1. Create a Play Console developer account; create the app (package `com.rangnenwars.mybudget`).
2. `npx eas-cli build --platform android --profile production` (produces the store-format bundle) → `npx eas-cli submit --platform android --profile production`.
3. Start in **Internal testing** (up to a small tester list, near-instant), then **Closed testing**, then **Production**.
4. You will need: a store listing (short + full description, screenshots, icon), a **privacy policy URL** (the app handles personal financial data — state what is stored, that it is private to the user, how deletion works: Settings → Delete my account), a **data-safety form**, and a content rating questionnaire.

### 3.4 Channel D — iOS (TestFlight, then App Store)

1. Enrol in the Apple Developer Program.
2. `npx eas-cli build --platform ios --profile production` then `npx eas-cli submit --platform ios` (EAS manages certificates; no Mac needed).
3. Invite testers through **TestFlight** (internal testers instantly; external testers after a short beta review), then submit for App Store review.
4. Apple requires in-app **account deletion** (already present in Settings) and a privacy policy URL. If you later charge for Pro, Apple/Google in-app-purchase rules apply — the current "admin grants Pro" model sidesteps this by not selling inside the app.

### 3.5 Optional: over-the-air updates

`expo-updates` / EAS Update can push JavaScript-only fixes to installed apps without a store release. It isn't configured in this repo (`app.json` has no `updates` block). Look up the v57 setup before adopting it; web users never need it.

---

## 4. Rollout plan

| Phase | Audience | Channels | Exit criteria |
|---|---|---|---|
| **0 — Prepare** (now) | you | — | prerequisite checklist in §2 all ticked; User Manual proofread; SMTP working; test with a fresh account end-to-end |
| **1 — Pilot** | 5–15 trusted users | A (web) | no data-loss or login bugs for 2 weeks; Report-issue inbox under control; backups verified |
| **2 — Android pilot** (optional) | pilot users who want an app | A + B (APK) | `eas.json` env fixed; APK installs and signs in against production |
| **3 — Wider launch** | friends/community/public | A + C (Play); D if iOS demand | privacy policy published; store listings approved; support routine in place |

---

## 5. Distributing the User Manual

| Option | How | Notes |
|---|---|---|
| **In the repo** | [USER_MANUAL.md](USER_MANUAL.md) | fine for you and developers; users won't browse GitHub |
| **PDF** | export the manual (a docs/Word/PDF export or the `pdf` skill) and attach to the welcome message | simplest for WhatsApp / email; mind that it is a snapshot — re-send on major changes |
| **Web page** | publish the manual as a page or shared document and use the **link** in the welcome message and in a footer on your own site | one place to update; recommended once you have more than a handful of users |
| **First-run tip** | (future) a "Help" link on the Dashboard pointing at the manual | small client change in `app/(tabs)/index.tsx` |

Keep the manual in step with the app: when a screen changes, update the matching section the same day (and the screen table in [README.md](README.md) §5).

---

## 6. Support loop

1. Users report problems in-app (bug icon); reports are stored in the database and — if you switch on the nightly digest (CONFIGURATION_STATE §3 gap 2) — e-mailed to admins each night with a priority and a suggested fix.
2. Account problems (forgotten password with no email, locked/deactivated account, Pro request) go to the admin: DB_ADMIN_QUERIES §3–§5.
3. Announce planned downtime or changes through the same channel you used to invite people (WhatsApp group / email list). Deploys cause only a few seconds of interruption, so most releases need no notice.
4. Review monthly: signups, active users, open issue reports (DB_ADMIN_QUERIES §8–§9).
