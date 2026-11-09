# Operator console: design and wireframes

Status: **design draft, nothing built** · drafted 2026-11-09 · wireframes **not yet approved**

Per the project rule, no code changes until the owner approves the wireframes in section 6.

## 1. Decisions already made (by the owner)

| Question | Answer |
|----------|--------|
| Who operates it? | **One person, the owner.** No roles, no two-person approval for now. |
| Where does it live? | **A separate web app**, not screens inside the customer app. |
| "View as user"? | **No.** Operators never see a customer's transactions, balances, loans or goals. |

Because it is a solo owner, we skip roles and approvals but keep the three things that matter most: **MFA**, an **audit log**, and **separate login**.

## 2. Why separate operators from app users

Today operators are rows in `users` with `role` = `admin`, `support` or `system_manager` (`server/src/db/schema.ts`). Problems:

- One login path. A flaw in customer sign-up or login can reach admin power.
- No second factor for the account that can switch off any user or change the payment QR.
- The owner's own account is a budget account too, counted in customer metrics (the `company` kind is a workaround).
- `requireStaff` and `requireSystemManager` hard-code who can do what.

Target: **operators and customers share nothing except the database server and a narrow, audited set of actions on customer accounts.**

```
CUSTOMER SIDE                          OPERATOR SIDE (separate app + login)
users                                  operators
 accounts, transactions, loans …       operator_sessions
 user_features, access_grants          operator_audit_log
 payment_claims, issue_reports         operator_notes
 access_notices                        job_runs
                                       announcements
        ▲                              (app_settings already holds payment QR / UPI)
        │
        └── operator routes (/ops/api/*) read account metadata only,
            and write only: active flag, features, plan/grants, payment
            claim decisions, issue status. Every write is logged.
```

## 3. Database design

New tables. Existing customer tables are unchanged except as noted.

### operators
| Column | Type | Notes |
|--------|------|-------|
| id | bigserial PK | |
| email | text, unique (lower) | |
| name | text | |
| password_hash | text | argon2/bcrypt as the app does today |
| totp_secret | text, encrypted | set during first login |
| mfa_enabled_at | timestamptz | login refused until set |
| recovery_codes_hash | text[] | 8 one-time codes, shown once |
| is_active | boolean | |
| failed_logins | int | locks after 5, unlocks after 15 min |
| last_login_at | timestamptz | |
| created_at / updated_at | timestamptz | |

Created only by a CLI script on the server (like `create-admin.ts`). No sign-up screen exists.

### operator_sessions
`id, operator_id, refresh_token_hash, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at`. Short life (access 10 min, refresh 8 h, no "remember me"). Separate cookie name and signing secret from the customer app.

### operator_audit_log
`id, operator_id, action, target_user_id, target_email (snapshot), before jsonb, after jsonb, reason text, ip, created_at`.
Append-only: the app's DB role has INSERT and SELECT only on this table. Replaces and extends the current `admin_audit_log` (old rows copied in).

### operator_notes
`id, operator_id, user_id, note text, created_at`. Private notes about a customer's account ("paid by cash 3 Nov", "asked for refund"). Never shown to the customer.

### job_runs
`id, job_name, trigger ('schedule' | 'manual'), started_at, finished_at, status ('ok' | 'failed' | 'running'), rows_affected int, error text, operator_id (null when scheduled)`. Written by each background job (recurring posting, month rollover, issue digest, net-worth snapshots, backup check).

### announcements
`id, kind ('info' | 'warning' | 'maintenance'), message, starts_at, ends_at, is_active, created_by`. The customer app reads active ones through a public endpoint and shows a banner. Maintenance mode is an `app_settings` flag (`maintenance_mode`, `maintenance_message`).

### Changes to existing tables
- `users.role`: after migration only `user` remains; `support` and `system_manager` are dropped from the check. Existing `admin`/`support`/`system_manager` rows move to `operators` (owner re-enrols MFA).
- `users.account_kind = 'company'` stays for free/comp accounts but is no longer needed for the owner.
- `issue_reports`: add `status ('new' | 'in_progress' | 'resolved')`, `resolved_at`, `operator_note`.

## 4. What the operator can do (and cannot)

**Can** (all logged):

1. **Find a user** by email, phone or ID. See: name, email, phone, plan, access end date, features on, active or not, verified or not, last login, created date, counts only (number of transactions, not contents).
2. **Account actions:** deactivate or reactivate, sign out everywhere, send password reset or verification email, delete account (typed confirmation, reason required, 24-hour cool-off before the data is purged).
3. **Plan and features:** grant or extend access, set a plan end date, switch Goals, Loans, Investments, Plan ahead on or off, answer feature requests.
4. **Payments:** approve or reject payment claims ("says they paid"), see the ledger of who paid what and when, set the payment QR image and UPI ID.
5. **Support:** work the issue inbox (screenshot, digest and suggested cause, status, internal note, reply by email).
6. **System:** metrics (sign-ups, active users, errors), job history with a **Run now** button, backup status, maintenance mode, announcements.
7. **Data integrity tools:** rollover anomaly check, re-run a user's failed recurring post. Each starts as a dry run that shows what would change.
8. **Own security:** change password, reset MFA codes, list and revoke own sessions, read the audit log.

**Cannot:**

- See or export a customer's transactions, balances, goals, loans, investments or people.
- Sign in as a customer.
- Change a customer's password directly (can only send a reset link).
- Edit or delete audit log rows.

If a customer asks for a data export (privacy request), that is a separate, explicit tool added later, with a reason and a log entry, and not part of the first build.

## 5. Security rules

1. Separate subdomain (for example `ops.<your-domain>`), separate cookie and JWT secret, CORS allows only the console origin.
2. MFA (TOTP) required on every login; first login forces set-up and shows recovery codes once.
3. Rate limit and lock on failed logins; every login (good or bad) is logged.
4. Optional IP allow-list in an env var (owner's home and phone ranges). Off by default.
5. Risky actions (delete account, change payment QR/UPI, maintenance mode on) ask for the **reason** and re-enter the MFA code, even though the session is open.
6. Console is not linked from the customer app and not in its bundle.
7. Security headers and `noindex`; no third-party scripts.

## 6. Wireframes (for approval)

Desktop-first, since the owner uses it from a laptop. It works on a phone too: the sidebar collapses to a menu and tables become cards.

### W1. Sign in and MFA

```
+--------------------------------------------+
|              Prapanji Operations           |
|                                            |
|   Email     [______________________]       |
|   Password  [______________________]       |
|                                            |
|            [      Continue       ]         |
|                                            |
|   ------------- step 2 ----------------   |
|   Enter the 6-digit code from your         |
|   authenticator app                        |
|            [ _ _ _ _ _ _ ]                 |
|            [      Sign in       ]          |
|   Use a recovery code instead              |
+--------------------------------------------+
First time only: shows a QR code to scan, then 8 recovery codes
("Save these now. They are shown once.") with a [I have saved them] button.
```

### W2. Dashboard (landing page)

```
+-----------+------------------------------------------------------+
| Dashboard | Dashboard                                 [Maintenance: OFF]
| Users     |------------------------------------------------------|
| Payments  |  Needs you                                           |
| Support   |  +--------------+ +--------------+ +--------------+  |
| Jobs      |  | 3 payment    | | 5 new issue  | | 2 feature    |  |
| System    |  | claims       | | reports      | | requests     |  |
| Audit log |  | [Review]     | | [Open]       | | [Open]       |  |
| Settings  |  +--------------+ +--------------+ +--------------+  |
|           |                                                      |
|           |  Health                                              |
|           |  Last backup: today 02:10  OK      Jobs: 1 failed    |
|           |  Server: OK   DB size: 412 MB      [View failed job] |
|           |                                                      |
|           |  Users                                               |
|           |  Total 1,204 | Active 7 days 388 | New this week 41  |
|           |  Paying 96   | Plans ending in 7 days: 8  [View]     |
|           |                                                      |
|           |  Recent actions (from audit log)                     |
|           |  10:42 Approved payment claim #88 (ravi@...)         |
|           |  09:15 Switched on Goals for asha@...                |
+-----------+------------------------------------------------------+
```

### W3. Users: search and list

```
Users
[ Search by email, phone or ID ______________ ] [Search]
Filter: [All v] [Plan: any v] [Status: any v] [Plan ends within: any v]

| Name        | Email           | Plan    | Ends       | Status   | Last login |
|-------------|-----------------|---------|------------|----------|------------|
| Asha K      | asha@...        | Paid    | 12 Mar 27  | Active   | today      |
| Ravi S      | ravi@...        | Trial   | 18 Nov 26  | Active   | 3 days ago |
| Meera P     | meera@...       | Expired | 02 Nov 26  | Active   | 9 days ago |
| Test one    | test@...        | Company | -          | Inactive | 2 months   |
                                                       < 1 2 3 ... >
```

### W4. User detail (no financial data)

```
< Users        Asha K  (asha@example.com)                   [Active]

+- Account ------------------------+ +- Plan and access ----------------+
| Phone    +91 98xxxxxx12          | | Plan      Paid                   |
| Email    verified                | | Ends      12 Mar 2027            |
| Joined   4 Jun 2026              | | [Extend access] [Set end date]   |
| Last login  today 08:12          | |                                  |
| Entries: 842  Accounts: 3        | | Features                         |
| (counts only)                    | | Goals [on]  Loans [off]          |
|                                  | | Investments [on] Plan ahead [on] |
+----------------------------------+ +----------------------------------+

+- Actions ------------------------------------------------------------+
| [Send password reset] [Send verification email] [Sign out everywhere]|
| [Deactivate]                                      [Delete account...] |
+----------------------------------------------------------------------+

+- Payments -----------+ +- Issues -----------+ +- Notes (private) -----+
| 12 Mar 26  Rs 499    | | #31 Login slow     | | 3 Nov: paid by cash,  |
| Approved (UPI)       | |     Resolved       | |   added 1 year        |
| [View ledger]        | | [View all]         | | [Add note]            |
+----------------------+ +--------------------+ +-----------------------+

+- History of actions on this account (audit log) -----------------------+
| 3 Nov 10:42  Extended access to 12 Mar 2027   reason: cash payment    |
+------------------------------------------------------------------------+
```

Every action opens a small confirm box: what will change, a **Reason** field when risky, and the MFA code for the three high-risk actions.

### W5. Payments

```
Payments            [Waiting 3] [Approved] [Rejected] [Ledger]

| When        | User     | Amount | Method  | Reference    | Action              |
|-------------|----------|--------|---------|--------------|---------------------|
| 9 Nov 09:12 | Ravi S   | Rs 499 | UPI     | UTR 4128...  | [Approve] [Reject]  |
| 8 Nov 21:40 | Meera P  | Rs 499 | QR      | -            | [Approve] [Reject]  |

Approve: choose [1 month | 1 year | custom date] -> Confirm
Reject: reason (sent to the user in their notice)

Payment settings
  UPI ID  [____________]    QR image [Upload]       [Save...]  (needs MFA code)
```

### W6. Support inbox

```
Support         [New 5] [In progress 2] [Resolved]

| #  | From     | Title              | Age  | Likely cause (auto)      |
|----|----------|--------------------|------|--------------------------|
| 34 | Asha K   | Balance looks off  | 2 h  | Rollover on 1st          |
| 33 | Ravi S   | Cannot add loan    | 1 d  | Loans feature off        |

Open an issue:
+------------------------------------------------------------------+
| Asha K  - Balance looks off            Status [New v]             |
| Message ...                          [Screenshot thumbnail]       |
| App version, device, page                                         |
| Suggested: ...                                                    |
| Internal note [____________]                      [Save note]     |
| Reply by email [__________________________]       [Send reply]   |
+------------------------------------------------------------------+
```

### W7. Jobs and maintenance

```
Jobs
| Job                     | Schedule | Last run         | Result | Rows |         |
|-------------------------|----------|------------------|--------|------|---------|
| Post repeating entries  | daily    | today 00:05      | OK     | 132  | [Run now]|
| Month rollover          | 1st      | 1 Nov 00:10      | OK     | 388  | [Run now]|
| Issue digest email      | nightly  | today 01:00      | OK     | 5    | [Run now]|
| Net worth snapshots     | daily    | today 00:20      | FAILED | -    | [Run now]|
|                                                      [View error]|

Run now opens a dry run first: "Would post 4 entries for 3 users". [Run for real]

System
  Maintenance mode  [ OFF ]   Message to users [______________]
  Announcements:    [+ New]   - "Planned downtime Sun 2-3 am" (active until 15 Nov)
  Backups:          Last OK today 02:10 - Last restore test 1 Nov  [View log]
  Integrity checks: [Run rollover anomaly check]  (read-only, lists users affected)
```

### W8. Audit log

```
Audit log
Filter: [Action v] [User ____] [From date] [To date]       [Export CSV]

| When         | Action                    | User         | Reason         | IP        |
|--------------|---------------------------|--------------|----------------|-----------|
| 9 Nov 10:42  | payment.approve           | ravi@...     | -              | 49.x.x.x  |
| 9 Nov 09:15  | feature.on (goals)        | asha@...     | requested      | 49.x.x.x  |
| 8 Nov 22:03  | login.failed              | (operator)   | -              | 103.x.x.x |
Click a row to see before and after values.
```

### W9. My security (Settings)

```
Settings
  Change password         [Change]
  Two-step codes          Enabled since 9 Nov     [Make new recovery codes]
  Signed-in devices       This laptop (now)       [Sign out]
                          Phone, 2 days ago       [Sign out]
                          [Sign out everywhere]
  Allowed IPs (optional)  [______________]
```

## 7. Build order (small slices, each approved first)

| Slice | What | Done when |
|-------|------|-----------|
| 1 | `operators`, `operator_sessions`, `operator_audit_log` tables; CLI to create the owner; login + MFA endpoints under `/ops/api`; W1 and W9 | Owner can sign in with MFA on the separate app |
| 2 | Move existing admin endpoints (users, features, plan/payments) to operator auth with audit logging; W3, W4 | Old `/admin/*` routes removed; same actions work |
| 3 | W5 payments and W2 dashboard | Claims approved from the console |
| 4 | W6 support inbox (`issue_reports.status`) | Issues worked and replied from the console |
| 5 | W7 jobs, maintenance mode, announcements (`job_runs`, `announcements`) + banner in the customer app | Run-now works; banner shows in customer app |
| 6 | W8 audit log page, integrity tools | |
| 7 | Retire `support`/`system_manager` roles from `users`; update tests and docs | `users.role` only `user` |

## 8. Console app layout (for later)

New folder `operator-console/` beside `server/` and the Expo client: a small web app (Vite + React, plain pages, no mobile build), its own Dockerfile and compose service `mybudget-ops`, served on its own subdomain. The server gets a `routes/ops/` folder with its own auth middleware. The customer bundle never imports from it.

## 9. Open questions

1. Authenticator app (TOTP) for MFA, or also a hardware key or SMS? Recommendation: TOTP only.
2. Subdomain name for the console.
3. Should deleting an account purge data after 24 hours, or keep a 30-day recovery window?
4. Should customers see a short notice when an operator changes their account (for example "Your access was extended")? The `access_notices` table already exists for this.
