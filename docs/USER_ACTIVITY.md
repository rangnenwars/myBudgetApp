# User activity (sign-ins, sign-outs, page hits)

Why: to learn how the app is used, and to give each person a history of their own sign-ins. Nothing else is recorded.

## What is recorded

| Event | When | Stored |
|---|---|---|
| Sign-in | Sign-in or sign-up succeeds | time, platform (web/android/ios), app version, visit id, **coarse location** (IPv4 /24, IPv6 /48) |
| Sign-out | One session is really ended, or "Sign out everywhere" | same, without a page |
| Page hit | A person opens a page, if "Share which pages I visit" is on | time, platform, visit id, the **page pattern** |

Never recorded: failed sign-ins, the real address or ids (`/people/42` is stored as `/people/[id]`), months, amounts, names, search text, or what a person typed. The list of allowed page patterns is `utils/pagePatterns.ts`, shared by the app and the server; the server drops anything else.

## Rules

1. "Share which pages I visit" is **on by default** (Settings, Privacy). Off: no page hits stored; sign-ins and sign-outs are still recorded (also the security history).
2. Raw rows are kept **90 days**. A nightly job (`lib/activityRetention.ts`, run by `jobs/scheduler.ts`) adds older rows up into `activity_daily` (anonymous counts per day, kind, page and platform, customer accounts only) and deletes them.
3. Who sees what: a person sees their own sign-ins (Settings, My sign-in history). **Admins** see one person's timeline; every look is written to the audit log (`viewed_activity`). **Admins and system managers** see the counts overview. Support sees none. Company (staff and tester) accounts are left out of counts.
4. Deleting the account deletes its activity (cascade). "Download my data" includes it (`activity`, plus `profile.shareActivity`).
5. Existing users start with sharing **on**, because the new column defaults to true. The Privacy Policy has a new paragraph (draft, needs a lawyer's check).

## How it fits together

* App: `utils/activity.ts` (buffer, visit id), `components/ActivityTracker.tsx` (sends a batch of up to 50 every 30 seconds and when the app goes to the background), `utils/api.ts` (sends `X-App-Platform`, `X-App-Version`, `X-Session-Id` on every request).
* Server: `lib/activity.ts` (record functions that never throw), `routes/activity.ts`, `routes/adminActivity.ts`, `middleware/rateLimit.ts` (`activityLimiter`, 30 a minute per account).
* A visit is grouped by the id the app sends; without one, a gap of more than 30 minutes starts a new visit.
* Tests: `server/src/__tests__/activity.test.ts`, `utils/__tests__/activity.test.ts`, `utils/__tests__/pagePatterns.test.ts`.
