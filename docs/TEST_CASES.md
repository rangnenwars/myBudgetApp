# Test cases for review

Generated 2026-11-09 from the Jest suites (every test name, grouped by file and section, with its latest result).

| Suite | Test files | Test cases | Passed | Failed |
|---|---|---|---|---|
| Server | 47 | 1028 | 1016 | 12 |
| Client | 11 | 191 | 191 | 0 |


---

## Server tests

### `src/__tests__/accessRules.test.ts` (34)

**addMonths**

- [PASS] adds calendar months and clamps to the end of a shorter month
- [PASS] crosses a year end and a leap day

**computeAccess**

- [PASS] a company account always has access and never expires
- [PASS] a running trial gives access until it ends
- [PASS] counts a part day as a day left
- [PASS] an ended trial is locked, and remembers when it ended
- [PASS] a customer with no grants at all is locked
- [PASS] paid beats trial, and a paid period queued after the trial is not live yet
- [PASS] an exception beats everything and may have no end date
- [PASS] a revoked or finished exception no longer counts
- [PASS] an exception does not move the date a renewal starts from
- [PASS] a revoked trial gives nothing
- [PASS] grace covers a locked user while a payment is being checked, and nothing else
- [PASS] a grant stamped a moment in the future by another clock still counts

**effectiveTier**

- [PASS] is the stored tier until the plan is enforced
- [PASS] once enforced, Pro means the plan is running and staff have not set Standard

**featuresFor**

- [PASS] before enforcement it is exactly the old rule: any switched-on row
- [PASS] once enforced, the plan gives every feature it includes
- [PASS] once enforced, old sign-up defaults and grandfathered rows no longer bypass the plan
- [PASS] once enforced, a feature switched on by hand keeps working without the plan, until its end date
- [PASS] a feature staff switched off for this user stays off, plan or not
- [PASS] a refused or waiting request does not block the plan

**plan settings**

- [PASS] defaults to ₹200 a year, six months free, 30 days notice, and nothing enforced
- [PASS] only lets an admin edit the price, period, free months, notice days and features

**transaction IDs**

- [PASS] accepts a 12-digit UTR and a longer alphanumeric reference, normalised
- [PASS] rejects anything too short, too long or with odd characters
- [PASS] shows only the last four characters back to the user

**renewing**

- [PASS] starts a paid period when the current one ends, or now if it already has
- [PASS] a year is twelve calendar months and a month-plan is one
- [PASS] grace is given once per access period

**reminder stages**

- [PASS] picks the stage an end date has reached
- [PASS] skips the gentler stages when a more urgent one is sent

**UPI details**

- [PASS] validates a UPI ID
- [PASS] reads the payee out of a upi://pay link, and nothing else

### `src/__tests__/account.test.ts` (12)

**email verification**

- [PASS] sends a link on sign-up; opening it marks the email verified, and the link works once
- [PASS] resend replaces the earlier link, and is refused once verified
- [PASS] rejects an unknown token

**forgotten password**

- [PASS] emails a reset link; the new password works, the old one does not, and every session is ended
- [PASS] answers 204 for an unknown email and sends nothing
- [PASS] rejects an expired link

**POST /auth/me/password**

- [PASS] needs the current password, ends other sessions, and keeps this device signed in

**POST /auth/me/logout-all**

- [PASS] revokes every refresh token for the account

**GET /auth/me/export**

- [PASS] returns all of the user's data as a JSON download, without secrets or other users' rows
- [PASS] includes the user's issue reports (a link to each screenshot, not the bytes) and free-money history

**DELETE /auth/me**

- [PASS] requires the password, then deletes the account and its data
- [PASS] lets an admin delete their account while another active admin remains

### `src/__tests__/admin.test.ts` (19)

**GET /api/v1/admin/users**

- [PASS] rejects a non-admin with 403
- [PASS] rejects an unauthenticated request with 401
- [PASS] lists accounts for an admin, without leaking password hashes

**PATCH /api/v1/admin/users/:id**

- [PASS] lets an admin deactivate another user, blocking their next login
- [PASS] lets an admin promote a user to admin
- [PASS] lets an admin change another user's tier
- [PASS] refuses to let an admin modify their own account through this endpoint
- [PASS] lets an admin demote another admin back to a regular user
- [PASS] rejects a non-admin caller with 403
- [PASS] rejects an empty patch body
- [PASS] returns 404 for a nonexistent account

**DELETE /api/v1/admin/users/:id**

- [PASS] lets an admin delete another user
- [PASS] refuses self-deletion
- [PASS] rejects a non-admin caller with 403
- [PASS] returns 404 for a nonexistent account

**Deactivated account access**

- [PASS] blocks refresh once the account is deactivated mid-session
- [PASS] blocks a deactivated admin's still-live access token from the admin API

**Deleted account access**

- [PASS] a deleted account's still-live access token is rejected on /auth/me
- [PASS] a deleted account's still-live access token is rejected on PATCH /auth/me/tier

### `src/__tests__/app.test.ts` (2)

**GET /health**

- [PASS] responds ok, unauthenticated

**unmatched routes**

- [PASS] returns a generic 404 JSON error

### `src/__tests__/auth.test.ts` (25)

**POST /api/v1/auth/register**

- [PASS] creates an account and returns tokens
- [PASS] rejects a duplicate email with 409
- [PASS] treats email case-insensitively for the duplicate check
- [PASS] rejects a short password with 400
- [PASS] rejects an invalid email with 400
- [PASS] stores the mobile number in +91 form, accepting spaces and a +91/0 prefix
- [PASS] rejects a missing mobile number
- [PASS] rejects a too short mobile number
- [PASS] rejects a starting with 5 mobile number
- [PASS] rejects a letters mobile number
- [PASS] rejects a second account with the same mobile number

**POST /api/v1/auth/login**

- [PASS] logs in with correct credentials
- [PASS] rejects a wrong password with a generic 401 (no user-enumeration hint)
- [PASS] rejects an unknown email with the same generic 401

**GET /api/v1/auth/me**

- [PASS] requires a bearer token
- [PASS] rejects a malformed Authorization header
- [PASS] rejects a garbage token
- [PASS] returns the authenticated user profile

**PATCH /api/v1/auth/me/tier**

- [PASS] flips tier to standard and back (the local plan toggle)
- [PASS] rejects an invalid tier value

**PATCH /api/v1/auth/me/tier › when self-service plan changes are off**

- [PASS] is refused with 403 by default in production, and the tier is unchanged
- [PASS] is allowed in production only when ALLOW_SELF_TIER_CHANGE=true, and refused anywhere when it is false

**POST /api/v1/auth/refresh**

- [PASS] issues a new token pair and rotates the old refresh token out
- [PASS] rejects an unknown refresh token

**POST /api/v1/auth/logout**

- [PASS] revokes the refresh token so it can no longer be used

### `src/__tests__/authCookie.test.ts` (7)

**web refresh-token cookie**

- [PASS] login sets an httpOnly, SameSite=Strict cookie and leaves the refresh token out of the body
- [PASS] refresh with the cookie rotates it, and the old cookie value then fails
- [PASS] the cookie is ignored without the opt-in header (no cross-site refresh)
- [PASS] logout revokes the cookie token and clears the cookie
- [PASS] logout without a token in the body or the opt-in header is a 400

**refresh token rotation under concurrency**

- [PASS] two simultaneous refreshes with the same token: exactly one succeeds

**login email lookup**

- [PASS] matches case-insensitively

### `src/__tests__/budgetsAccounts.test.ts` (19)

**accounts**

- [PASS] requires authentication
- [PASS] creates, lists, updates and deletes accounts, isolated per user
- [PASS] rejects an unknown type or empty patch
- [PASS] counts in the net-worth snapshot: balances add, credit-card dues subtract

**budgets**

- [PASS] sets a limit and reports spending against it with ok / warning / over
- [PASS] replaces an existing limit rather than adding a second one, and deletes it
- [PASS] only allows expense categories the user can see
- [PASS] removes a custom category's budget when the category is deleted

**GET /transactions/page**

- [PASS] pages newest-first with a cursor until the end
- [PASS] searches notes and category names (case-insensitive, % taken literally), and filters by type and date
- [PASS] adds up expenses for one day and for a month, whatever the page size (the Transactions tabs)
- [PASS] never returns another user's rows and rejects a bad cursor or limit

**overall monthly budget**

- [PASS] requires authentication
- [PASS] starts empty, with a suggestion from last months spending
- [PASS] counts a month with no spending as zero in the suggestion, instead of leaving it out
- [PASS] does not average in months before the first entry
- [PASS] counts day-to-day spending, leaves EMIs and investments out, and works out per day
- [PASS] starts every month fresh (no carry-over) and shows no days left for a past month
- [PASS] is private to each user, rejects a bad amount, and can be removed

### `src/__tests__/bugfixes.test.ts` (8)

**transaction category must match its type**

- [PASS] rejects an expense in an income category on create
- [PASS] rejects a PATCH that flips only the type, leaving the category on the wrong side

**deleting a transaction updates the budget class**

- [PASS] drops back once the big expense is removed

**renaming a category**

- [PASS] refuses a name another visible category of the same type already has

**editing a goal’s saved amount directly**

- [PASS] records the difference in the contribution history

**POST /transactions/batch**

- [PASS] saves every entry
- [PASS] saves nothing when any entry is invalid

**investment returns no longer overflow**

- [PASS] stores a 10,000× gain (999,900%) without a database error

### `src/__tests__/categories.test.ts` (17)

**GET /api/v1/categories**

- [PASS] requires authentication
- [PASS] returns the system categories, none marked custom
- [PASS] does not include another user's custom categories

**POST /api/v1/categories**

- [PASS] creates a custom category owned by the caller
- [PASS] rejects a blank name
- [PASS] rejects an invalid type

**PATCH /api/v1/categories/:key**

- [PASS] lets the owner rename their own custom category, keeping the key stable
- [PASS] a rename doesn't break a transaction already referencing the category
- [PASS] refuses to rename a system category
- [PASS] hides another user's custom category behind a 404
- [PASS] rejects a blank name

**DELETE /api/v1/categories/:key**

- [PASS] lets the owner delete their own unused custom category
- [PASS] refuses to delete a system category
- [PASS] hides another user's custom category behind a 404, not a 403
- [PASS] refuses to delete a custom category that is still in use
- [PASS] returns 404 for a nonexistent key

**POST /api/v1/transactions category ownership**

- [PASS] rejects a transaction referencing another user's custom category

### `src/__tests__/categorisedExpenses.test.ts` (3)

**Category totals for a month or a year**

- [PASS] adds up to the period total and matches the Transactions filter for a whole year
- [PASS] is empty for a period with no expenses
- [PASS] counts only the user's own share of a split bill

### `src/__tests__/clock.test.ts` (3)

**localToday**

- [PASS] uses India time by default: 1 Oct 00:30 IST is still 30 Sep in UTC
- [PASS] rolls the year over at 31 Dec in the app time zone

**addMonths**

- [PASS] moves across year boundaries both ways

### `src/__tests__/cors.test.ts` (3)

**CORS allow-list**

- [PASS] with CORS_ORIGIN unset (local dev), any origin is allowed
- [PASS] with CORS_ORIGIN set, listed origins are allowed and others get no CORS header
- [PASS] requests with no Origin header (native app, curl) still succeed

### `src/__tests__/dbIntegrity.test.ts` (5)

**a user's custom category can't be used by anyone else**

- [PASS] rejects a transaction, repeating entry or budget pointing at another user's category
- [PASS] still allows the owner's own category and any system category
- [PASS] rejects moving an existing row onto another user's category

**goal contributions belong to the goal owner**

- [PASS] rejects a contribution recorded under a different user than the goal's
- [PASS] still cascades: deleting a goal removes its contributions

### `src/__tests__/e2e.test.ts` (2)

**end-to-end: a full user session**

- [PASS] register -> log real activity -> reports reflect it -> logout invalidates the session
- [PASS] two independent users never see each other's data across the whole flow

### `src/__tests__/featurePricing.test.ts` (8)

**feature catalog for users**

- [PASS] lists every feature with the plan's price and period

**switching on for a period**

- [PASS] lasts a month, a year, or has no end
- [PASS] rejects an unknown period

**when access ends**

- [PASS] turns the feature off for the user but keeps their data
- [FAIL] is not counted as someone having the feature
- [PASS] lets the user ask again, and staff see the request with whether they said they paid

**asking without paying**

- [PASS] records a plain request and keeps asking harmless while one is waiting
- [PASS] does nothing for a feature the user already has

### `src/__tests__/features.test.ts` (22)

**feature routes are refused when the feature is off**

- [PASS] GET /api/v1/goals needs goals
- [PASS] GET /api/v1/loans needs loans
- [PASS] GET /api/v1/investments needs investments
- [PASS] GET /api/v1/reports/debt-payoff needs loans
- [PASS] GET /api/v1/reports/goal-eta needs goals
- [PASS] allows the route once the feature is on, and only that feature
- [PASS] lists the switched-on features on /auth/me

**switching a feature off keeps the data**

- [PASS] hides goals while off and brings them back when on
- [PASS] leaves a hidden feature out of net worth
- [PASS] leaves loan EMIs out of the free-money day while Loans is off

**asking for a feature**

- [PASS] files one request, shows it to staff, and closes it when switched on
- [PASS] closes the request as won’t fix when staff leave the feature off
- [PASS] does nothing for a feature that is already on
- [PASS] rejects an unknown feature

**who can see and change feature access**

- [PASS] lets support look but not switch
- [PASS] lets a system manager switch a feature for a user
- [PASS] refuses a regular user on every admin feature endpoint
- [PASS] needs a signed-in user
- [PASS] 404s for a missing user and 400s for a bad body or key
- [PASS] lists who has a feature on

**sign-up defaults**

- [PASS] gives a new account what staff chose, and logs the change
- [PASS] rejects a defaults body with a missing or unknown feature

### `src/__tests__/forecast.test.ts` (21)

**ruleDatesBetween**

- [PASS] falls back to the last day of short months and returns to the day after
- [PASS] puts quarterly and yearly entries only in the months they fall due
- [PASS] stops at the end date, and an already-ended rule gives nothing
- [PASS] skips occurrences before the window starts

**buildForecast**

- [PASS] covers the 12 months after the current one
- [PASS] adds repeating income and bills, with a yearly bill landing in its own month
- [PASS] does not count an ended income rule as income
- [PASS] reports no income when there is no rule and no average
- [PASS] pays a loan down month by month until it is cleared
- [PASS] counts this month's unposted EMI before projecting
- [PASS] keeps EMIs of a loan that counts as an expense unnamed when Loans is off, and skips ones that do not
- [PASS] finds the tightest month and the average left over

**buildForecast › typical spending**

- [PASS] averages the last three full months by category
- [PASS] leaves out loan EMIs and entries a repeating rule posted, so bills are not counted twice
- [PASS] still counts a second entry in the same category on a rule day
- [PASS] skips the month of the user's first entry, and falls back to known-only when no full month is left
- [PASS] is unavailable for a user with no entries at all

**GET /forecast**

- [PASS] requires authentication
- [PASS] refuses a user who does not have Plan ahead
- [PASS] returns 12 months built from the user’s repeating entries
- [PASS] never shows another user’s entries

### `src/__tests__/goals.test.ts` (23)

**savings goals CRUD**

- [PASS] rejects unauthenticated requests
- [PASS] lists only the caller's own goals
- [PASS] creates a goal starting at zero saved
- [PASS] assigns different colors round-robin as goals accumulate
- [PASS] creates a goal with a deadline and defaults to null without one
- [PASS] rejects a malformed deadline on POST and PATCH
- [PASS] updates and clears the deadline via PATCH
- [PASS] updates saved_amount via PATCH
- [PASS] rejects a non-positive target amount
- [PASS] updates name and target_amount via PATCH, not just saved_amount
- [PASS] rejects an empty patch body
- [PASS] rejects a non-positive target_amount on PATCH
- [PASS] rejects a negative saved_amount on PATCH
- [PASS] returns 404 patching a nonexistent goal
- [PASS] cannot update another user's goal
- [PASS] adds funds via POST /:id/contributions and records history
- [PASS] removes funds, reducing saved_amount, when enough is saved
- [PASS] rejects removing more than is currently saved
- [PASS] rejects a contribution with a non-positive amount or invalid type
- [PASS] returns 404 contributing to a nonexistent or another user's goal
- [PASS] rejects unauthenticated contribution requests
- [PASS] deletes a goal, scoped to the owner

**POST /api/v1/goals/:id/contributions under concurrency**

- [PASS] ten simultaneous adds all land — none overwrite another

### `src/__tests__/investments.test.ts` (12)

**investments CRUD**

- [PASS] rejects unauthenticated requests
- [PASS] lists only the caller's own investments
- [PASS] rejects a non-positive amount
- [PASS] computes returns_percent server-side, never trusting a client-supplied value
- [PASS] falls back current_value to amount, and gain to 0%, when current_value is omitted
- [PASS] computes a negative gain for a loss
- [PASS] recomputes returns_percent on PATCH when current_value changes
- [PASS] recomputes returns_percent on PATCH using the existing current_value when only amount changes
- [PASS] updates name/type via PATCH without touching the numbers
- [PASS] rejects an empty patch body
- [PASS] cannot update another user's investment
- [PASS] deletes an investment, scoped to the owner

### `src/__tests__/issueAnalysis.test.ts` (14)

**tokenize / jaccard**

- [PASS] drops stopwords, short words and numbers, and stems plurals
- [PASS] keeps words ending in ss intact
- [PASS] scores identical sets 1 and disjoint sets 0

**extractErrorSignatures**

- [PASS] finds error names, HTTP statuses, timeouts and NaN
- [PASS] returns nothing for plain prose

**analyzeIssues**

- [PASS] clusters near-duplicate reports and raises their priority
- [PASS] groups reports that quote the same error even with different wording
- [PASS] computes totals, week-over-week trend, breakdowns and hotspots
- [PASS] flags a new app version that already has several reports
- [PASS] handles an empty stack

**heuristicSuggestion**

- [PASS] points at the screen and server files plus keyword-specific hints

**scheduler timing**

- [PASS] waits until later today, or rolls over to tomorrow
- [PASS] parses HH:MM and falls back to 02:00

**startNightlyJobs**

- [PASS] schedules the next run at ISSUE_DIGEST_TIME and can be cancelled

### `src/__tests__/issueConstants.test.ts` (3)

**issue constants stay in sync with the database**

- [PASS] categories, severities and statuses match the CHECK constraints
- [PASS] the screenshot cap matches the database limit
- [PASS] every screen key is unique and every named screen file exists (the digest points developers at it)

### `src/__tests__/issueDigestRender.test.ts` (7)

**renderDigest**

- [PASS] summarises the stack analysis, then each issue with its full suggestion
- [PASS] by default names the reporter by id and attaches no screenshots
- [PASS] when opted in, attaches screenshots until 15 MB, then links the rest
- [PASS] handles a report with no optional fields and a rule-based suggestion

**digest recipients and locking**

- [PASS] falls back to every active admin when ISSUE_DIGEST_TO is unset
- [PASS] skips a run while another process holds the digest lock
- [PASS] runs when the lock is free, and releases it afterwards

### `src/__tests__/issueSuggestions.test.ts` (3)

**suggestFix**

- [PASS] is worked out on the server from the report and the stack analysis
- [PASS] still suggests something without analysis context

**issue reports never leave the server**

- [PASS] the server depends on no AI / outside-processing SDK

### `src/__tests__/issues.test.ts` (21)

**POST /api/v1/issues**

- [PASS] requires sign-in
- [PASS] lets any user file a report without a screenshot
- [PASS] stores a screenshot sent as a data URL and serves it back to the reporter only
- [PASS] stores the sniffed image type, not the declared one
- [PASS] accepts a screenshot of exactly 2 MB and rejects one byte more
- [PASS] rejects a file that is not an image, and malformed base64
- [PASS] answers 413 (not 500) for a body over the route limit
- [PASS] validates the default fields

**GET /api/v1/issues/mine and staff triage**

- [PASS] lists only the caller's own reports
- [PASS] only staff can list every report and change a status

**nightly digest**

- [PASS] analyses, suggests, emails pending reports once, and marks them notified
- [PASS] dry run writes nothing and sends nothing
- [PASS] leaves reports pending (with the suggestion kept for the retry) when the send fails
- [PASS] attaches screenshots and names the reporter only when opted in
- [PASS] without SMTP, logs only the subject (never the report text) and leaves reports pending

**issue-report screenshot privacy**

- [PASS] support staff cannot open another user's screenshot; admins can
- [PASS] answers 404 for a report with no screenshot, and 400 for a non-numeric id
- [PASS] staff can filter the triage list by status; an unknown status is a 400 and an unknown report a 404

**screenshot retention**

- [PASS] drops screenshots of reports closed longer ago than the retention period, keeping the text
- [PASS] reads the retention period from the environment, ignoring blank or invalid values
- [PASS] runs every night even when the digest email is switched off

### `src/__tests__/loans.test.ts` (61)

**loans CRUD**

- [PASS] rejects unauthenticated requests
- [PASS] lists only the caller's own loans
- [PASS] creates a loan, defaulting is_active to true
- [PASS] defaults counts_as_expense to true and lets it be set on create
- [PASS] toggles counts_as_expense via PATCH without touching other fields
- [PASS] rejects a non-boolean counts_as_expense
- [PASS] rejects a negative outstanding balance
- [PASS] updates outstanding via PATCH
- [PASS] updates any combination of editable fields via PATCH, not just outstanding
- [PASS] rejects an empty patch body
- [PASS] cannot update or delete another user's loan
- [PASS] deletes a loan

**loans CRUD › POST /loans/:id/pay-emi**

- [PASS] is refused for a loan whose EMI is posted and paid down automatically, leaving it untouched
- [PASS] lowers the balance of a loan that does not count as an expense, with no expense at all
- [PASS] takes only the remaining balance on the final instalment
- [PASS] rejects paying a loan that is already fully paid
- [PASS] rejects a malformed date
- [PASS] returns 404 for another user's loan and leaves it untouched
- [PASS] requires authentication

**loans CRUD › automatic monthly EMI expenses**

- [PASS] posts the current month's EMI as an expense the first time data is read, and only once
- [PASS] is included in report totals and the category breakdown
- [PASS] skips loans that are excluded from expenses or already fully paid, and posts one per counted loan
- [PASS] does not bring back an auto-posted transaction the user deleted
- [PASS] corrects this month's posted EMI when the loan's EMI or name is edited
- [PASS] does not double-post when several requests arrive at once
- [PASS] catches up the months missed since the last posting, one EMI per month, oldest first
- [PASS] does not back-fill the months a loan was off when it is switched back on
- [PASS] does not double-post when a loan is switched off and on again within the same month
- [PASS] stops posting once the loan is fully paid off
- [PASS] does not reduce the balance on a loan's first posting — the balance entered is already today's
- [PASS] pays the balance down by each posted month's principal (no rate: the whole EMI)
- [PASS] splits each EMI into interest and principal at the loan rate, and caps the final instalment

**loans CRUD › loan details**

- [PASS] saves and updates tenure, start date, type, lender and note
- [PASS] rejects an out-of-range interest rate or amount with 400

**loans CRUD › monthsToPost**

- [PASS] is just the current month for a loan that was never posted
- [PASS] is empty when already posted for the current month
- [PASS] lists each missed month oldest first, across a year boundary
- [PASS] caps a very long gap at the most recent 24 months

**loans CRUD › POST /loans/:id/part-payment**

- [PASS] lowers outstanding, scales the EMI to keep the tenure, and logs a part-payment expense
- [PASS] uses the adjusted EMI for the next "mark EMI paid"
- [PASS] lowers the balance but logs no expense when the loan does not count as an expense
- [PASS] closes the loan and keeps the EMI when the payment equals the outstanding balance
- [PASS] rejects a payment larger than the outstanding balance without changing anything
- [PASS] rejects a payment on a loan that is already fully paid
- [PASS] rejects an invalid amount (0)
- [PASS] rejects an invalid amount (-5)
- [PASS] rejects an invalid amount (abc)
- [PASS] rejects a malformed date
- [PASS] returns 404 for another user's loan and leaves it untouched
- [PASS] requires authentication

**POST /api/v1/loans/:id/part-payment under concurrency**

- [PASS] simultaneous part payments each reduce the balance — none is lost

**loan payment history**

- [PASS] records a part payment with the balance after it, for a loan that counts as an expense
- [PASS] records a part payment for a loan that does not count as an expense, where no transaction exists
- [PASS] records a manual mark-EMI-paid, newest first
- [PASS] records the EMI that is posted automatically each month
- [PASS] shows what has been part-paid so far on the loan list, and zero for a loan with none
- [PASS] will not show another user a loan history, and is a 404 for a loan that does not exist
- [PASS] does not record a refused part payment

**loan payment history › backfill from old part-payment transactions (migration 0023)**

- [PASS] files each old part payment under the one loan with that name, without a balance
- [PASS] skips payments whose loan name is shared by two loans, or no longer exists
- [PASS] never files one user payment under another user loan of the same name

### `src/__tests__/mail.test.ts` (9)

**mailer**

- [PASS] is configured only with both SMTP_HOST and SMTP_FROM
- [PASS] refuses to send when not configured
- [PASS] uses implicit TLS on 465, sends from SMTP_FROM, and reuses one transport
- [PASS] defaults to port 587 with STARTTLS and no auth, and honours SMTP_SECURE

**account mail**

- [PASS] captures mail in the outbox under test
- [PASS] in production without SMTP, warns without ever logging the link (it is a credential)
- [PASS] in development without SMTP, prints the email so links can be tested locally
- [PASS] sends through SMTP when configured outside tests
- [PASS] builds links from APP_URL without a trailing slash, and escapes the HTML

### `src/__tests__/mailer.test.ts` (7)

**mailer (Resend over HTTPS)**

- [PASS] is configured with a Resend key + sender, or with SMTP host + sender, and not otherwise
- [PASS] MAIL_FROM falls back to SMTP_FROM so existing SMTP setups keep working
- [PASS] posts to the Resend API with a bearer key and the message as JSON
- [PASS] splits a comma-joined recipient list (the issue digest sends "a, b") into an array
- [PASS] maps inline screenshot attachments to base64 + content_id
- [PASS] throws with Resend's message on an HTTP error, without leaking the API key
- [PASS] refuses to send with no recipients, and with nothing configured

### `src/__tests__/middlewareUnits.test.ts` (9)

**errorHandler**

- [PASS] maps AppError, ZodError and body-parser errors to their status
- [PASS] answers 500 with a generic message and never logs SQL parameters
- [PASS] notFoundHandler answers a JSON 404

**readCookie**

- [PASS] finds one cookie among several, URL-decoded
- [PASS] returns undefined with no header, no match, or a part without "="
- [PASS] falls back to the raw value when it is not valid URL encoding

**error helpers**

- [PASS] carry the right status, with sensible default messages

**role guards**

- [PASS] let the right roles through and reject everyone else with 403

**sniffImageType**

- [PASS] recognises PNG, JPEG and WebP from their first bytes, and nothing else

### `src/__tests__/monthRollover.test.ts` (13)

**month and year rollover for one user**

- [PASS] 31 Oct: October holds everything posted since the first entry, and November is still empty
- [PASS] 1 Nov: the 1st-of-month items post, the later ones wait, and October does not move
- [PASS] 2 Nov: rent posts, and reading again does not post anything twice
- [PASS] 2 Nov: the free-money day counts the same repeating items as the month does
- [PASS] 2 Nov: Plan ahead starts in December and puts each item in its real month
- [PASS] 30 Nov: the gym falls back from the 31st to the 30th
- [PASS] left unopened until 2 Jan: December and January both catch up, across the year boundary
- [PASS] Plan ahead after the new year starts in February and no longer includes the loan

**budgets and month-on-month insights across month and year boundaries**

- [PASS] 31 Oct: October is over budget, with a suggestion from September and a middle budget class
- [PASS] 1 Nov: November starts from the full budget, and October keeps its own result
- [PASS] 6 Nov: spending this month counts only against November, and Home compares it with October
- [PASS] left unopened until 2 Jan: January is a fresh month, and October drops out of the budget class
- [PASS] 2 Jan: the comparison crosses the year, December against January

### `src/__tests__/monthlyExpenses.test.ts` (2)

**Monthly expenses match the Transactions month filter**

- [PASS] has the same total for every month, keeps empty months as 0, and counts expenses only
- [PASS] gives a category breakdown that adds up to the month total

### `src/__tests__/negativeApi.test.ts` (299)

**not signed in**

- [PASS] get /api/v1/auth/me is refused with 401
- [PASS] patch /api/v1/auth/me/tier is refused with 401
- [PASS] post /api/v1/auth/me/password is refused with 401
- [PASS] post /api/v1/auth/me/logout-all is refused with 401
- [PASS] get /api/v1/auth/me/export is refused with 401
- [PASS] delete /api/v1/auth/me is refused with 401
- [PASS] get /api/v1/categories is refused with 401
- [PASS] post /api/v1/categories is refused with 401
- [PASS] patch /api/v1/categories/x is refused with 401
- [PASS] delete /api/v1/categories/x is refused with 401
- [PASS] get /api/v1/transactions is refused with 401
- [PASS] get /api/v1/transactions/page is refused with 401
- [PASS] get /api/v1/transactions/range is refused with 401
- [PASS] post /api/v1/transactions is refused with 401
- [PASS] post /api/v1/transactions/batch is refused with 401
- [PASS] post /api/v1/transactions/split is refused with 401
- [PASS] post /api/v1/transactions/split-people is refused with 401
- [PASS] patch /api/v1/transactions/1 is refused with 401
- [PASS] delete /api/v1/transactions/1 is refused with 401
- [PASS] get /api/v1/recurring is refused with 401
- [PASS] post /api/v1/recurring is refused with 401
- [PASS] patch /api/v1/recurring/1 is refused with 401
- [PASS] delete /api/v1/recurring/1 is refused with 401
- [PASS] get /api/v1/accounts is refused with 401
- [PASS] post /api/v1/accounts is refused with 401
- [PASS] patch /api/v1/accounts/1 is refused with 401
- [PASS] delete /api/v1/accounts/1 is refused with 401
- [PASS] get /api/v1/budgets is refused with 401
- [PASS] get /api/v1/budgets/overall is refused with 401
- [PASS] put /api/v1/budgets/overall is refused with 401
- [PASS] put /api/v1/budgets/internet is refused with 401
- [PASS] delete /api/v1/budgets/internet is refused with 401
- [PASS] get /api/v1/people is refused with 401
- [PASS] post /api/v1/people is refused with 401
- [PASS] get /api/v1/people/1 is refused with 401
- [PASS] patch /api/v1/people/1 is refused with 401
- [PASS] delete /api/v1/people/1 is refused with 401
- [PASS] post /api/v1/people/1/entries is refused with 401
- [PASS] delete /api/v1/people/1/entries/1 is refused with 401
- [PASS] get /api/v1/loans is refused with 401
- [PASS] post /api/v1/loans is refused with 401
- [PASS] patch /api/v1/loans/1 is refused with 401
- [PASS] get /api/v1/loans/1/payments is refused with 401
- [PASS] post /api/v1/loans/1/pay-emi is refused with 401
- [PASS] post /api/v1/loans/1/part-payment is refused with 401
- [PASS] delete /api/v1/loans/1 is refused with 401
- [PASS] get /api/v1/investments is refused with 401
- [PASS] post /api/v1/investments is refused with 401
- [PASS] patch /api/v1/investments/1 is refused with 401
- [PASS] delete /api/v1/investments/1 is refused with 401
- [PASS] get /api/v1/goals is refused with 401
- [PASS] post /api/v1/goals is refused with 401
- [PASS] patch /api/v1/goals/1 is refused with 401
- [PASS] post /api/v1/goals/1/contributions is refused with 401
- [PASS] get /api/v1/goals/1/contributions is refused with 401
- [PASS] delete /api/v1/goals/1 is refused with 401
- [PASS] get /api/v1/reports/summary is refused with 401
- [PASS] get /api/v1/reports/monthly-series is refused with 401
- [PASS] get /api/v1/reports/category-breakdown is refused with 401
- [PASS] get /api/v1/reports/export.csv is refused with 401
- [PASS] get /api/v1/reports/debt-payoff is refused with 401
- [PASS] get /api/v1/reports/goal-eta is refused with 401
- [PASS] get /api/v1/reports/free-money-day is refused with 401
- [PASS] get /api/v1/forecast is refused with 401
- [PASS] post /api/v1/net-worth/snapshot is refused with 401
- [PASS] get /api/v1/net-worth/history is refused with 401
- [PASS] get /api/v1/features is refused with 401
- [PASS] post /api/v1/features/goals/request is refused with 401
- [PASS] get /api/v1/plan is refused with 401
- [PASS] get /api/v1/plan/payment-details is refused with 401
- [PASS] get /api/v1/plan/claims is refused with 401
- [PASS] post /api/v1/plan/claims is refused with 401
- [PASS] post /api/v1/plan/claims/1/cancel is refused with 401
- [PASS] post /api/v1/issues is refused with 401
- [PASS] get /api/v1/issues/mine is refused with 401
- [PASS] get /api/v1/admin/users is refused with 401
- [PASS] patch /api/v1/admin/users/1 is refused with 401
- [PASS] delete /api/v1/admin/users/1 is refused with 401
- [PASS] get /api/v1/admin/audit-log is refused with 401
- [PASS] get /api/v1/admin/features is refused with 401
- [PASS] put /api/v1/admin/features/defaults is refused with 401
- [PASS] get /api/v1/admin/features/goals/users is refused with 401
- [PASS] get /api/v1/admin/users/1/features is refused with 401
- [PASS] put /api/v1/admin/users/1/features/goals is refused with 401
- [PASS] get /api/v1/admin/plan is refused with 401
- [PASS] put /api/v1/admin/plan is refused with 401
- [PASS] get /api/v1/admin/plan/dry-run is refused with 401
- [PASS] post /api/v1/admin/plan/notify-existing is refused with 401
- [PASS] put /api/v1/admin/plan/enforcement is refused with 401
- [PASS] get /api/v1/admin/plan/expiring is refused with 401
- [PASS] get /api/v1/admin/payment-details is refused with 401
- [PASS] put /api/v1/admin/payment-details is refused with 401
- [PASS] get /api/v1/admin/payments is refused with 401
- [PASS] get /api/v1/admin/payments/1/screenshot is refused with 401
- [PASS] post /api/v1/admin/payments/1/confirm is refused with 401
- [PASS] post /api/v1/admin/payments/1/reject is refused with 401
- [PASS] post /api/v1/admin/users/1/payments is refused with 401
- [PASS] get /api/v1/admin/users/1/access is refused with 401
- [PASS] put /api/v1/admin/users/1/account-kind is refused with 401
- [PASS] put /api/v1/admin/users/1/exception is refused with 401
- [PASS] get /api/v1/admin/exceptions is refused with 401
- [PASS] get /api/v1/system/metrics is refused with 401
- [PASS] get /api/v1/issues is refused with 401
- [PASS] patch /api/v1/issues/1 is refused with 401

**signed in with something that is not a session**

- [PASS] gibberish is refused on a protected route
- [PASS] an empty token is refused on a protected route
- [PASS] three dots is refused on a protected route
- [PASS] a token signed with another secret is refused on a protected route
- [PASS] an expired token is refused on a protected route
- [PASS] a token with no algorithm is refused on a protected route
- [PASS] an Authorization header with a different scheme is refused
- [PASS] an Authorization header with no scheme is refused
- [PASS] an Authorization header with a lower-case word only is refused
- [PASS] a refresh token cannot be used as an access token
- [PASS] a deactivated account loses access straight away

**an ordinary user on staff routes**

- [PASS] get /api/v1/admin/users is refused with 403
- [PASS] patch /api/v1/admin/users/1 is refused with 403
- [PASS] delete /api/v1/admin/users/1 is refused with 403
- [PASS] get /api/v1/admin/audit-log is refused with 403
- [PASS] get /api/v1/admin/features is refused with 403
- [PASS] put /api/v1/admin/features/defaults is refused with 403
- [PASS] get /api/v1/admin/features/goals/users is refused with 403
- [PASS] get /api/v1/admin/users/1/features is refused with 403
- [PASS] put /api/v1/admin/users/1/features/goals is refused with 403
- [PASS] get /api/v1/admin/plan is refused with 403
- [PASS] put /api/v1/admin/plan is refused with 403
- [PASS] get /api/v1/admin/plan/dry-run is refused with 403
- [PASS] post /api/v1/admin/plan/notify-existing is refused with 403
- [PASS] put /api/v1/admin/plan/enforcement is refused with 403
- [PASS] get /api/v1/admin/plan/expiring is refused with 403
- [PASS] get /api/v1/admin/payment-details is refused with 403
- [PASS] put /api/v1/admin/payment-details is refused with 403
- [PASS] get /api/v1/admin/payments is refused with 403
- [PASS] get /api/v1/admin/payments/1/screenshot is refused with 403
- [PASS] post /api/v1/admin/payments/1/confirm is refused with 403
- [PASS] post /api/v1/admin/payments/1/reject is refused with 403
- [PASS] post /api/v1/admin/users/1/payments is refused with 403
- [PASS] get /api/v1/admin/users/1/access is refused with 403
- [PASS] put /api/v1/admin/users/1/account-kind is refused with 403
- [PASS] put /api/v1/admin/users/1/exception is refused with 403
- [PASS] get /api/v1/admin/exceptions is refused with 403
- [PASS] get /api/v1/system/metrics is refused with 403
- [PASS] get /api/v1/issues is refused with 403
- [PASS] patch /api/v1/issues/1 is refused with 403

**support staff can look but not change**

- [PASS] put /api/v1/admin/plan is refused
- [PASS] post /api/v1/admin/plan/notify-existing is refused
- [PASS] put /api/v1/admin/plan/enforcement is refused
- [PASS] put /api/v1/admin/payment-details is refused
- [PASS] post /api/v1/admin/payments/1/confirm is refused
- [PASS] post /api/v1/admin/payments/1/reject is refused
- [PASS] post /api/v1/admin/users/1/payments is refused
- [PASS] put /api/v1/admin/users/1/account-kind is refused
- [PASS] put /api/v1/admin/users/1/exception is refused
- [PASS] put /api/v1/admin/features/defaults is refused
- [PASS] put /api/v1/admin/users/1/features/goals is refused
- [PASS] patch /api/v1/admin/users/1 is refused
- [PASS] delete /api/v1/admin/users/1 is refused
- [PASS] cannot read payment screenshots

**a feature the user does not have**

- [PASS] get /api/v1/loans is refused with 403
- [PASS] post /api/v1/loans is refused with 403
- [PASS] get /api/v1/investments is refused with 403
- [PASS] post /api/v1/investments is refused with 403
- [PASS] get /api/v1/goals is refused with 403
- [PASS] post /api/v1/goals is refused with 403
- [PASS] switching a feature off stops a user who was using it

**another user's data**

- [PASS] cannot edit a transaction
- [PASS] cannot delete a transaction
- [PASS] cannot edit an account
- [PASS] cannot delete an account
- [PASS] cannot open a person
- [PASS] cannot rename a person
- [PASS] cannot add to a persons ledger
- [PASS] cannot delete a person
- [PASS] cannot edit a loan
- [PASS] cannot pay a loan EMI
- [PASS] cannot part-pay a loan
- [PASS] cannot read loan payments
- [PASS] cannot delete a loan
- [PASS] cannot edit an investment
- [PASS] cannot delete an investment
- [PASS] cannot edit a goal
- [PASS] cannot add to a goal
- [PASS] cannot read goal contributions
- [PASS] cannot delete a goal
- [PASS] a stranger's lists and reports are empty, not the owner's
- [PASS] cannot split a bill with someone else's friend

**malformed and missing ids**

- [PASS] the id "abc" is a 400 everywhere, never a 500
- [PASS] the id "0" is a 400 everywhere, never a 500
- [PASS] the id "-1" is a 400 everywhere, never a 500
- [PASS] the id "1.5" is a 400 everywhere, never a 500
- [PASS] the id "1e3" is a 400 everywhere, never a 500
- [PASS] the id "99999999999999999999" is a 400 everywhere, never a 500
- [PASS] the id "%20" is a 400 everywhere, never a 500
- [PASS] the id "null" is a 400 everywhere, never a 500
- [PASS] an id that is well-formed but does not exist is a 404

**bad request bodies**

- [PASS] a transaction dated "2026-02-30" is refused and not saved
- [PASS] a transaction dated "2026-13-01" is refused and not saved
- [PASS] a transaction dated "2026-00-10" is refused and not saved
- [PASS] a transaction dated "26-01-01" is refused and not saved
- [PASS] a transaction dated "01/02/2026" is refused and not saved
- [PASS] a transaction dated "2026-1-5" is refused and not saved
- [PASS] a transaction dated "yesterday" is refused and not saved
- [PASS] a transaction dated "" is refused and not saved
- [PASS] a transaction dated "2026-02-29" is refused and not saved
- [PASS] a transaction dated "2026-04-31" is refused and not saved
- [PASS] a transaction dated 20260101 is refused and not saved
- [PASS] accepts 29 February only in a leap year
- [PASS] a transaction with no amount is refused and not saved
- [PASS] a transaction with no type is refused and not saved
- [PASS] a transaction with no category is refused and not saved
- [PASS] a transaction with no date is refused and not saved
- [PASS] a transaction with an unknown type is refused and not saved
- [PASS] a transaction with an empty category is refused and not saved
- [PASS] a transaction with a category that does not exist is refused and not saved
- [PASS] a transaction with an income category on an expense is refused and not saved
- [PASS] a transaction with an expense category on income is refused and not saved
- [PASS] a transaction with a note that is too long is refused and not saved
- [PASS] a transaction with a category key that is too long is refused and not saved
- [PASS] a transaction with a repeat with no end is refused and not saved
- [PASS] a transaction with an unknown repeat is refused and not saved
- [PASS] a transaction with an array instead of an object is refused and not saved
- [PASS] a transaction with a string instead of an object is refused and not saved
- [PASS] a transaction with an empty object is refused and not saved
- [PASS] a batch with no entries saves nothing
- [PASS] a batch with 51 entries saves nothing
- [PASS] a batch with one bad entry among good ones saves nothing
- [PASS] a person with an empty name is refused
- [PASS] a person with a blank name is refused
- [PASS] a person with a name that is too long is refused
- [PASS] a person with a number for a name is refused
- [PASS] a person with an object for a name is refused
- [PASS] a person with no name is refused
- [PASS] a person entry with an unknown kind is refused
- [PASS] a person entry with no kind is refused
- [PASS] a person entry with an invalid due date is refused
- [PASS] a person entry with an invalid date is refused
- [PASS] a person entry with a note that is too long is refused
- [PASS] an account with an unknown type is refused
- [PASS] an account with no name is refused
- [PASS] an account with a name that is too long is refused
- [PASS] a goal with an invalid deadline is refused
- [PASS] a goal with no name is refused
- [PASS] a goal with a name that is too long is refused
- [PASS] an update with nothing to change is refused
- [PASS] unknown fields are ignored and cannot set who owns a row
- [PASS] text that looks like code is stored as plain text and does no harm
- [PASS] a search for % or _ matches only that text

**bad requests on the wire**

- [PASS] broken JSON is a 400 with no stack trace
- [PASS] a body over the size limit is refused with 413 and nothing is saved
- [PASS] form-encoded data is not accepted as JSON
- [PASS] an unknown route is a clean 404
- [PASS] the wrong method on a real route is not a success

**bad query strings**

- [PASS] /api/v1/transactions with { month: 13, year: 2026 } is a 400
- [PASS] /api/v1/transactions with { month: 0, year: 2026 } is a 400
- [PASS] /api/v1/transactions with { month: 'May', year: 2026 } is a 400
- [PASS] /api/v1/transactions with { month: 5, year: 1999 } is a 400
- [PASS] /api/v1/transactions with { month: 5, year: 2101 } is a 400
- [PASS] /api/v1/transactions/page with { limit: 0 } is a 400
- [PASS] /api/v1/transactions/page with { limit: 201 } is a 400
- [PASS] /api/v1/transactions/page with { limit: 'ten' } is a 400
- [PASS] /api/v1/transactions/page with { type: 'transfer' } is a 400
- [PASS] /api/v1/transactions/range with { startMonth: 1, startYear: 2026 } is a 400
- [PASS] /api/v1/transactions/range with { startMonth: 13, startYear: 2026, endMonth: 1, endYear: 2026 } is a 400
- [PASS] /api/v1/reports/summary with { startMonth: 'a', startYear: 2026, endMonth: 1, endYear: 2026 } is a 400
- [PASS] /api/v1/reports/monthly-series with { startMonth: 1, startYear: 2026 } is a 400
- [PASS] /api/v1/reports/category-breakdown with { type: 'nothing' } is a 400
- [PASS] /api/v1/budgets with { month: 99, year: 2026 } is a 400

**sign-up and sign-in**

- [PASS] registration with no email is refused
- [PASS] registration with an email without @ is refused
- [PASS] registration with an email with spaces is refused
- [PASS] registration with a password of 7 characters is refused
- [PASS] registration with no password is refused
- [PASS] registration with a number for a password is refused
- [PASS] registration with no name is refused
- [PASS] registration with a blank name is refused
- [PASS] registration with a phone number that is too short is refused
- [PASS] registration with a phone number with letters is refused
- [PASS] registration with a phone number starting with 1 is refused
- [PASS] cannot register as an admin or choose a tier
- [PASS] a second account with the same email or phone is refused
- [PASS] a wrong password and an unknown email look the same, so nobody can find out who has an account
- [PASS] login with no password is refused
- [PASS] login with no email is refused
- [PASS] login with an empty body is refused
- [PASS] login with an object for the password is refused
- [PASS] login with an array for the email is refused
- [PASS] a deactivated user cannot sign in
- [PASS] a used or invented refresh token gets no new session
- [FAIL] changing a password needs the right current password and a long enough new one
- [FAIL] deleting an account needs the password
- [FAIL] an admin cannot be demoted, deactivated or deleted by an ordinary user, and cannot be changed by name alone

**paid plan abuse**

- [FAIL] a payment claim with no transaction id is refused and nothing is held
- [FAIL] a payment claim with a transaction id that is too short is refused and nothing is held
- [FAIL] a payment claim with a transaction id with symbols is refused and nothing is held
- [FAIL] a payment claim with a screenshot that is not an image is refused and nothing is held
- [FAIL] a payment claim with a screenshot that is not base64 is refused and nothing is held
- [FAIL] cannot cancel or see another user's claim
- [FAIL] a user cannot set their own account kind, grant themselves an exception, or read the payment screenshot
- [FAIL] the profile cannot be told it has more access than the server computed

### `src/__tests__/netWorth.test.ts` (4)

**net worth snapshot + history**

- [PASS] rejects unauthenticated requests
- [PASS] computes net worth as investments + goals saved - loans outstanding
- [PASS] upserts rather than duplicating within the same month
- [PASS] scopes history to the requesting user

### `src/__tests__/numberEdges.test.ts` (74)

**amount bounds on a transaction**

- [PASS] rejects zero
- [PASS] rejects negative
- [PASS] rejects a tiny negative
- [PASS] rejects text
- [PASS] rejects empty text
- [PASS] rejects null
- [PASS] rejects Infinity as text
- [PASS] rejects one paise over the maximum
- [PASS] rejects far over the maximum
- [PASS] accepts one paise and stores it exactly
- [PASS] accepts a whole rupee and stores it exactly
- [PASS] accepts the largest allowed and stores it exactly
- [PASS] keeps no more than paise when given a fraction of a paisa
- [PASS] accepts an amount sent as text digits (the app sends numbers, other clients may not)

**totals do not drift**

- [PASS] thirty entries of 0.10 add up to exactly 3.00
- [PASS] mixed awkward amounts add up to the paise
- [PASS] editing an amount changes the total by exactly the difference
- [PASS] deleting every entry brings the total back to exactly zero

**splitting a bill between categories**

- [PASS] accepts lines that add up to the total to the paise
- [PASS] refuses lines that are one paise short of the total, and saves nothing
- [PASS] refuses lines that are one paise over of the total, and saves nothing
- [PASS] refuses lines that are half of the total, and saves nothing
- [PASS] refuses lines that are double of the total, and saves nothing

**splitting a bill with people**

- [PASS] an equal split of 100 between you and 2 friends adds back to the total
- [PASS] an equal split of 100 between you and 3 friends adds back to the total
- [PASS] an equal split of 0.05 between you and 3 friends adds back to the total
- [PASS] an equal split of 1000.01 between you and 7 friends adds back to the total
- [PASS] an equal split of 99999.99 between you and 13 friends adds back to the total
- [PASS] refuses a bill too small to give everyone a paisa, and saves nothing
- [PASS] a custom split must not give friends more than the bill

**a loan paid down in EMIs**

- [PASS] ends on exactly zero, with a smaller last payment, and then refuses more
- [PASS] the payments listed add up to what was borrowed
- [PASS] refuses a part payment of zero and leaves the balance alone
- [PASS] refuses a part payment of negative and leaves the balance alone
- [PASS] refuses a part payment of more than is owed and leaves the balance alone
- [PASS] a part payment of one paise lowers the balance by one paise
- [PASS] a part payment equal to the balance closes the loan on exactly zero
- [PASS] a part payment keeps the number of remaining EMIs the same
- [PASS] refuses to create a loan with interest of 100% or more
- [PASS] refuses to create a loan with negative interest
- [PASS] refuses to create a loan with zero EMI
- [PASS] refuses to create a loan with negative balance
- [PASS] refuses to create a loan with zero principal
- [PASS] refuses to create a loan with a tenure of 0 months
- [PASS] refuses to create a loan with a tenure over 600 months
- [PASS] refuses to create a loan with a fractional tenure

**savings goals**

- [PASS] three additions of 0.10 make exactly 0.30
- [PASS] refuses to take out more than is saved, and leaves the balance alone
- [PASS] taking out exactly what is saved leaves exactly zero
- [PASS] refuses a contribution of zero
- [PASS] refuses a contribution of negative
- [PASS] refuses a contribution of text
- [PASS] refuses a target of zero or less

**what you are owed by people**

- [PASS] lending 0.10 and 0.20 gives exactly 0.30, and getting 0.30 back gives exactly zero
- [PASS] many small amounts still add up to the paise
- [PASS] getting back one paise more than you lent is refused
- [PASS] an entry of zero is refused
- [PASS] an entry of negative is refused
- [PASS] an entry of text is refused
- [PASS] an entry of above the maximum is refused

**budgets**

- [PASS] moves from ok to warning to over as spending grows, never backwards
- [PASS] reaching the limit counts as over, and 80 percent is the warning line
- [PASS] spending nothing is ok at ratio zero
- [PASS] refuses a limit of 0
- [PASS] refuses a limit of -100
- [PASS] refuses a limit of lots
- [PASS] refuses a limit of 10000000000
- [PASS] refuses an overall monthly budget of 0
- [PASS] refuses an overall monthly budget of -1
- [PASS] refuses an overall monthly budget of x

**accounts and investments**

- [PASS] an account balance can be negative (a credit card) but only within the limit
- [PASS] an investment can be worth zero but not less

**free-money day with unusual numbers**

- [PASS] does not blow up with no income at all
- [PASS] does not return NaN or Infinity when income is tiny against large bills

### `src/__tests__/payments.test.ts` (39)

**payment details (admin)**

- [PASS] only an admin can change them; support can look
- [PASS] asks for the password, and refuses a wrong one
- [PASS] refuses a QR that pays a different UPI ID than the one typed
- [PASS] asks the admin to confirm a QR it cannot read, and records that it was confirmed by hand
- [PASS] checks the UPI ID, the name and the image
- [PASS] refuses a QR image over 1 MB
- [PASS] saves a matching QR, tells every admin, and logs it

**what every user sees**

- [PASS] the QR, the UPI ID, the amount and a link that opens their UPI app
- [PASS] needs a signed-in user
- [PASS] says so when no details are set up

**"I have paid"**

- [PASS] records the transaction ID and screenshot as waiting, showing only the last four characters back
- [PASS] accepts a spaced or lower-case transaction ID and stores it tidy
- [PASS] needs a real transaction ID and a real image
- [PASS] allows one waiting payment at a time, and cancelling frees the transaction ID
- [PASS] nobody can cancel someone else's payment
- [PASS] one transaction ID can back one payment, whoever sends it
- [PASS] one screenshot can back one payment
- [PASS] allows three submissions a day, counting cancelled ones
- [PASS] company accounts do not pay
- [PASS] two people sending the same ID at the same moment: exactly one wins

**access while a payment is being checked**

- [PASS] keeps a lapsed user going for a few days, once per access period, and no longer than the claim waits
- [PASS] ends the hold when the payment is rejected
- [PASS] does nothing for someone whose plan is still running

**confirming a payment**

- [PASS] only an admin can: support and users are refused
- [PASS] adds a year that starts when the current period ends, so renewing early loses no time
- [PASS] starts from today when the plan has already ended, and the user is paid at once
- [PASS] stacks a second renewal after the first
- [PASS] cannot be confirmed twice, even by two admins at once, and adds only one period
- [PASS] refuses an amount below the plan price, and saves the price at the time it was paid
- [PASS] cannot confirm a cancelled or rejected payment
- [PASS] is in the audit log with who did it

**rejecting a payment**

- [PASS] tells the user why, frees the transaction ID, and leaves their access alone
- [PASS] can ask the user to send it again
- [PASS] flags an ID that was sent before and not accepted

**screenshots**

- [PASS] only an admin can open one, and it is never cached
- [PASS] are removed 30 days after the payment is decided, keeping the ID, amount and who confirmed it
- [PASS] are kept while the payment is still waiting

**recording a payment by hand**

- [PASS] adds the period, emails a receipt, and refuses a reference already used
- [PASS] is admin only, and needs a proper amount and reference

### `src/__tests__/people.test.ts` (17)

**people**

- [PASS] requires authentication
- [PASS] creates a person with a zero balance and lists them
- [PASS] rejects blank, over-long and duplicate names (any letter case)
- [PASS] lets two users keep a person with the same name
- [PASS] tracks money lent, part payments and settling to zero
- [PASS] tracks money borrowed and repaid
- [PASS] refuses a payment bigger than what is owed, in either direction
- [PASS] adds rupees and paise without floating-point drift
- [PASS] writes off what is left, keeping the history
- [PASS] requires an amount for everything except a write-off, and rejects bad amounts and dates
- [PASS] flags a balance as overdue once its due date has passed, and lets the date be changed or cleared
- [PASS] is never overdue when nothing is owed
- [PASS] renames a person, refusing a name already used
- [PASS] undoes a mistaken line and recomputes the balance
- [PASS] deletes a person together with their lines
- [PASS] never exposes or changes another user's people
- [PASS] rejects a non-numeric id

### `src/__tests__/planAccess.test.ts` (20)

**sign-up**

- [PASS] starts the free period from the sign-up date and says so in the welcome email
- [PASS] uses the free months an admin has set
- [PASS] tells the app where the user stands, without enforcing anything

**before enforcement: nobody is locked**

- [PASS] a user whose free period ended keeps the access and tier they had

**after enforcement**

- [PASS] a running trial gives every feature and Pro
- [PASS] an ended trial is locked by the server, with the usual reason code, and nothing saved is touched
- [PASS] the always-free parts keep working after the plan ends
- [PASS] a paid period gives access, and one queued after the trial starts when the trial ends
- [PASS] an exception with an end date works until then, and stops after
- [PASS] an exception with no end date works until an admin removes it
- [PASS] a company account always has access, even with no grants
- [PASS] only the features the plan includes are given
- [PASS] old sign-up defaults and grandfathered rows no longer bypass the plan
- [PASS] a feature an admin switched on by hand keeps working after the plan ends, until its end date
- [PASS] a feature staff switched off for this user stays off while the plan runs
- [PASS] an admin can set an account to Standard on purpose
- [PASS] every optional feature is switched off at once when the plan ends, with no job to run

**the features page**

- [PASS] shows the plan's price once, and when each included feature ends
- [PASS] shows "ended" after the plan ends, and asking for an included feature changes nothing

**tier endpoint**

- [PASS] returns the plan with the tier

### `src/__tests__/planAdmin.test.ts` (35)

**plan settings**

- [PASS] staff can read them; a customer cannot
- [PASS] only an admin can change the price, and the change is logged
- [PASS] refuses nonsense, and will not let this form turn enforcement on
- [PASS] the price can change without touching what people already paid

**the dry run**

- [PASS] lists who would lose the plan if enforcement were on now, and nobody who would keep it
- [PASS] ignores accounts an admin has switched off

**the notice to existing users**

- [PASS] moves end dates to at least the notice period, emails each person once with their own date, and is safe to repeat
- [PASS] does not email company accounts, accounts with an exception, or switched-off accounts
- [PASS] through the app: admin only, with the password, and logged

**the enforcement switch**

- [PASS] asks for the password, admins only
- [PASS] will not turn on before existing users have had the notice
- [PASS] turns on after the notice, logs it, and can be turned off again as the rollback
- [PASS] switching it off straight away gives everyone their access back

**company accounts**

- [PASS] an admin can mark an account Company and back, and it is logged
- [PASS] is admin only, refuses nonsense, and nobody changes their own
- [PASS] leaves a changed-to-customer account without a free period, so an admin decides what it gets

**exceptions**

- [PASS] needs a reason, and an end date is optional
- [PASS] with a date, lasts through the end of that day in India, and then stops
- [PASS] refuses a date in the past, a made-up date, a date more than five years away, and a bad format
- [PASS] a new exception replaces the old one, which stays in the history; turning it off ends it
- [PASS] is admin only, and meaningless for a company account
- [PASS] is logged with the reason and the date
- [PASS] the exceptions list shows reasons and end dates, and flags ones with no end
- [PASS] an ended or removed exception is not listed

**one user's access sheet**

- [PASS] shows the type, where they stand, the history and any exception

**the expiring-soon list**

- [PASS] shows who ends in the next 30 days and who ended in the last 30, and leaves out everyone else

**reminder emails**

- [PASS] says nothing until the plan is enforced
- [PASS] sends each stage once as the end date comes closer, and never repeats
- [PASS] someone who joins close to the end gets one email, not a pile
- [PASS] someone whose access already ended is told once that it ended
- [PASS] does not write to company accounts, exception holders, switched-off accounts, or people with plenty of time
- [PASS] a renewal starts a fresh set of reminders for the new end date
- [PASS] a paid user's reminder says renewing adds a year after the current end, so no time is lost

**only admins do money things**

- [PASS] a system manager can read the plan page but not change anything
- [PASS] a user promoted to admin gets the powers at once, and loses them when demoted

### `src/__tests__/rateLimit.test.ts` (2)

**auth rate limiting**

- [PASS] a correct password is not counted, and the 11th failed login in the window is refused with 429
- [PASS] the 6th registration from one IP in the window is refused with 429

### `src/__tests__/recurring.test.ts` (40)

**repeat every month**

- [PASS] requires authentication
- [PASS] creates the entry on its date plus a rule, and posts nothing more in the same month
- [PASS] deleting a repeating entry with stop_repeat removes its rule, so it can be added again
- [PASS] a plain delete leaves the rule alone
- [PASS] does not create a rule unless asked to
- [PASS] rejects a non-boolean repeat_monthly without creating anything
- [PASS] rejects an invalid category without leaving a rule behind
- [PASS] posts each month since the original entry, oldest first, with the rule amount
- [PASS] counts posted income and expenses in the report totals for the current month
- [PASS] uses a generic note when the entry had none
- [PASS] is idempotent across repeated reads and parallel requests
- [PASS] does not bring back a posted transaction the user deleted
- [PASS] caps a very old start at the most recent 24 months

**repeat every month › making an existing transaction repeat**

- [PASS] copies the transaction into a rule and posts from the following month
- [PASS] takes a frequency and repeats on the transaction's own day of the month
- [PASS] refuses an identical rule so a double tap cannot double-post
- [PASS] returns 404 for another user's transaction and 400 for a bad id
- [PASS] requires authentication

**repeat every month › editing and stopping**

- [PASS] changes the amount only for months not yet posted
- [PASS] rejects an empty or invalid patch
- [PASS] stops posting once deleted, but keeps what was already posted
- [PASS] cannot see, edit or delete another user's rule
- [PASS] blocks deleting a category that a repeating entry uses

**postDueRecurring schedule**

- [PASS] posts on the rule's day, falling back to the last day of shorter months, and waits for this month's day
- [PASS] posts quarterly rules every third month
- [PASS] posts yearly rules once a year
- [PASS] postingDate handles leap years

**repeat frequency via the API**

- [PASS] POST /transactions with repeat_frequency saves a rule on the entry's day
- [PASS] refuses a second identical repeating entry with 409 and saves nothing
- [PASS] PATCH frequency/day recomputes the next due date from the last period posted
- [PASS] rejects an impossible date

**repeat end date**

- [PASS] a new repeat must say when it ends
- [PASS] stops posting at the end date, even when catching up months later
- [PASS] an end date before the repeat day in its last month leaves that month out
- [PASS] hides an expired rule from the list and lets the same repeat be added again
- [PASS] an old rule with no choice yet keeps posting and stays listed
- [PASS] PATCH sets an end date or No end date, each clearing the other

**Loan EMI entries cannot repeat**

- [PASS] refuses a repeating Loan EMI on POST /transactions, saving nothing
- [PASS] refuses to make an existing Loan EMI entry repeat via POST /recurring
- [PASS] still lets other EMI-style categories repeat

### `src/__tests__/reports.test.ts` (11)

**reports auth**

- [PASS] rejects unauthenticated requests

**GET /api/v1/reports/summary**

- [PASS] sums income and expense for the range

**GET /api/v1/reports/monthly-series**

- [PASS] returns one point per month in range, zero-filled where there are no transactions

**GET /api/v1/reports/category-breakdown**

- [PASS] groups by category and sorts descending

**GET /api/v1/reports/export.csv**

- [PASS] returns a CSV with the transaction rows

**GET /api/v1/reports/debt-payoff**

- [PASS] orders by smallest balance first under the snowball strategy
- [PASS] prioritizes the higher interest-rate loan under the avalanche strategy

**GET /api/v1/reports/goal-eta**

- [PASS] returns one ETA entry per goal
- [PASS] averages the last 3 full months, not counting the half-finished current month
- [PASS] does not average in months before the first entry as zeros
- [PASS] uses the current month so far when there is no full month yet

### `src/__tests__/roles.test.ts` (17)

**support role — GET /api/v1/admin/users**

- [PASS] can list accounts, same as admin

**lastLoginAt**

- [PASS] is set on register and refreshed on login

**support role — PATCH /api/v1/admin/users/:id**

- [PASS] can activate/deactivate a user, and it sets deactivatedAt
- [PASS] is rejected with 403 when it tries to change role
- [PASS] is rejected with 403 when it tries to change tier
- [PASS] is refused with 403 when deactivating an admin, which stays active
- [PASS] is refused with 403 when deactivating another support account, which stays active
- [PASS] is refused with 403 when deactivating a system manager, which stays active

**support role — DELETE /api/v1/admin/users/:id**

- [PASS] is rejected with 403 — deletion stays admin-only

**system_manager role — account surface stays out of reach**

- [PASS] cannot list accounts via /api/v1/admin/users
- [PASS] cannot patch an account

**regular user — every staff surface stays out of reach**

- [PASS] gets 403 from /api/v1/admin/users, /api/v1/admin/audit-log, /api/v1/system/metrics

**GET /api/v1/system/metrics**

- [PASS] rejects a non-system-manager, non-admin caller with 403
- [PASS] is reachable by admin and by system_manager, and never returns financial rows

**GET /api/v1/admin/audit-log**

- [PASS] rejects support (admin-only) with 403
- [PASS] records an entry when an admin changes an account, readable only by admin
- [PASS] keeps a readable entry after the target account is deleted

### `src/__tests__/scaling.test.ts` (4)

**CSV export streams in batches**

- [PASS] exports every row of a range bigger than one 1,000-row batch, newest first

**report totals computed in the database**

- [PASS] match the transactions they summarise

**staff lists are paged and searched on the server**

- [PASS] searches accounts by name or email, newest first, with a total count header
- [PASS] pages the audit log with a before-id cursor

### `src/__tests__/security.test.ts` (9)

**ending sessions takes effect immediately**

- [PASS] a password change rejects access tokens issued before it, but the new pair works
- [PASS] sign out everywhere rejects every existing access token
- [PASS] deactivation by an admin cuts off the access token and the refresh token at once

**input validation returns 400, never 500**

- [PASS] rejects a non-numeric or negative id
- [PASS] rejects amounts beyond the column size and over-long text

**security headers**

- [PASS] sends helmet headers and no X-Powered-By

**CSV export**

- [PASS] neutralises spreadsheet formulas and quotes line breaks

**GET /health**

- [PASS] reports ok when the database answers

**login does not reveal which emails have accounts**

- [PASS] runs the bcrypt comparison for an unknown email too, so timing matches a wrong password

### `src/__tests__/splitFreeMoney.test.ts` (33)

**POST /transactions/split**

- [PASS] requires authentication
- [PASS] saves one entry per line, all sharing a split group
- [PASS] leaves ordinary entries without a split group
- [PASS] accepts lines that add up despite floating-point noise
- [PASS] rejects lines that do not add up to the total, saving nothing
- [PASS] rejects fewer than two lines, and the same category twice
- [PASS] saves nothing when any category is invalid (all or nothing)
- [PASS] rejects a category of the wrong type, and non-positive or malformed amounts
- [PASS] rejects another user's custom category
- [PASS] lets a user split across their own custom category

**weekStartOf**

- [PASS] returns the Monday of the week

**GET /reports/free-money-day**

- [PASS] requires authentication
- [PASS] reports no_income for a new user, and stores no snapshot
- [PASS] works out the day from repeating income, loan EMIs and repeating expenses
- [PASS] falls back to last months' average income when nothing repeats
- [PASS] uses this month's income so far when there is no earlier history
- [PASS] prefers earlier full months over a partly logged current month
- [PASS] averages the last three full months, ignoring anything older
- [PASS] counts a tracked month with no income as zero, so an irregular earner is not overstated
- [PASS] only counts months since the first entry, so a new user is not averaged with empty months
- [PASS] is not stretched by an old backdated entry from before the app was in use
- [PASS] skips a first month that has no income, since the user started part-way through it
- [PASS] counts a first month that does have income
- [PASS] reports no_income when nothing was earned in the last three tracked months
- [PASS] a small repeating income does not hide the salary logged by hand
- [PASS] still counts EMIs that keep posting while Loans is switched off, without naming the loan
- [PASS] counts every active loan while Loans is on, even one whose EMI is not posted
- [PASS] spreads a quarterly repeating bill over three months
- [PASS] still reports no_income when the user has logged no income at all
- [PASS] flags commitments larger than income, and caps an EMI at what is still owed
- [PASS] keeps the week's first reading and compares it with last week's
- [PASS] does not call a reading older than last week's "last week"
- [PASS] never mixes in another user's data

### `src/__tests__/splitPeople.test.ts` (10)

**POST /transactions/split-people**

- [PASS] requires authentication
- [PASS] splits equally: your share is the spending, each friend owes theirs
- [PASS] keeps the leftover paise with you so the parts always add up
- [PASS] splits with custom amounts, and your share is the rest
- [PASS] records no spending when friends cover the whole bill, but still tracks what they owe
- [PASS] adds to what a person already owes
- [PASS] rejects shares bigger than the total, missing custom amounts, duplicates and empty lists
- [PASS] saves nothing when a person isn't the caller's, or the category is wrong
- [PASS] keeps the friends' lines when the user's own entry is deleted
- [PASS] lets a friend settle a split share like any other debt

### `src/__tests__/tapThrough.test.ts` (4)

**Transactions page totals for a filter**

- [PASS] counts and adds up exactly what the filters match
- [PASS] respects a date range, and only the first page carries the totals
- [PASS] never counts another user's entries

**Ids on plan-ahead and free-money lines**

- [PASS] lets the app open the repeating bill behind a line

### `src/__tests__/transactions.test.ts` (16)

**transactions CRUD**

- [PASS] rejects unauthenticated requests
- [PASS] creates and lists a transaction scoped to the current month/year
- [PASS] filters the list by ?month=&year=
- [PASS] rejects a non-positive amount
- [PASS] rejects an invalid type
- [PASS] rejects a malformed date
- [PASS] updates amount, category, note and date via PATCH
- [PASS] rejects a PATCH to a category that is not a system category or the caller's own
- [PASS] rejects an empty patch body
- [PASS] recomputes budget_class after an edit changes the amount
- [PASS] cannot update another user's transaction
- [PASS] never returns another user's transactions (scoping)
- [PASS] cannot delete another user's transaction
- [PASS] deletes a transaction
- [PASS] recomputes budget_class server-side after adding a transaction

**GET /api/v1/transactions/range**

- [PASS] only returns transactions inside the requested month range


---

## Client tests

### `utils/__tests__/amount.test.ts` (5)

**parseAmount**

- [PASS] reads plain numbers
- [PASS] keeps the whole number when it has commas or spaces (not just the digits before the first one)
- [PASS] drops a leading rupee sign or Rs
- [PASS] is NaN for anything that is not a plain number, instead of a truncated value
- [PASS] rejects negatives unless allowed, as for an account balance below zero

### `utils/__tests__/calculations.test.ts` (83)

**classifyLocal**

- [PASS] classifies below 30k as low
- [PASS] classifies negative outflow as low (no negative-spend edge case exists in practice)
- [PASS] classifies boundary values into the upper bracket
- [PASS] classifies just under each boundary into the lower bracket

**computeMonthSummary**

- [PASS] returns zeros for no transactions
- [PASS] sums income and expense separately
- [PASS] produces negative net savings when expenses exceed income

**computeCategoryBreakdown**

- [PASS] returns empty for no matching transactions
- [PASS] groups by category and sums, ignoring the other type
- [PASS] sorts descending by total

**computeSavingsRate**

- [PASS] returns 0 when income is 0
- [PASS] computes percentage correctly
- [PASS] returns a negative rate when spending exceeds income

**generateMonthRange**

- [PASS] returns a single point for the same start/end month
- [PASS] wraps across a year boundary
- [PASS] returns an empty array for a reversed range

**computeMonthlySeries**

- [PASS] fills in zeros for months with no transactions

**formatMonthLabel**

- [PASS] formats the first and last month correctly

**computeCategoryDeltas**

- [PASS] marks a brand-new category with a null deltaPct
- [PASS] computes percentage increase against a previous baseline
- [PASS] handles a category dropping to zero this period
- [PASS] sorts by absolute delta amount, descending

**computeNetWorth**

- [PASS] is zero with no data
- [PASS] adds investment current value, goal savings, and subtracts loan outstanding
- [PASS] falls back to invested amount when current_value is null

**computeDebtOrder**

- [PASS] orders snowball by smallest outstanding balance first
- [PASS] orders avalanche by highest interest rate first
- [PASS] excludes loans that are already paid off

**simulateDebtPayoff**

- [PASS] returns [] for no loans
- [PASS] pays off a single loan in the expected number of months
- [PASS] snowballs the freed-up EMI into the next loan, finishing it faster than its own EMI alone would
- [PASS] avalanche prioritizes the higher interest-rate loan for extra payments
- [PASS] finishes faster with a larger extra monthly payment
- [PASS] does not include a loan whose EMI can never outpace its balance (safety cap reached)

**computePartPayment**

- [PASS] lowers the balance and scales the EMI by the same ratio
- [PASS] keeps the remaining number of instalments unchanged
- [PASS] rounds to paise so repeated payments do not drift
- [PASS] leaves the EMI untouched and reports no months left when the payment clears the loan
- [PASS] never lets the EMI fall to zero

**computeGoalETA**

- [PASS] reports already-reached goals as 0 months
- [PASS] returns nulls when average savings is zero or negative
- [PASS] rounds up to the next whole month and computes the ETA date

**transactionsToCsv**

- [PASS] produces just the header for an empty list
- [PASS] writes one row per transaction in the declared column order
- [PASS] quotes and escapes fields containing commas or quotes

**bucketForGroup**

- [PASS] classifies loan-related groups as loan
- [PASS] classifies the investments group as investment
- [PASS] falls back to expense for everything else

**monthlyEquivalent**

- [PASS] passes monthly amounts through unchanged
- [PASS] divides quarterly amounts by 3
- [PASS] divides yearly amounts by 12
- [PASS] handles zero

**splitEmi**

- [PASS] splits an EMI into a month of interest at rate/12 and the rest as principal
- [PASS] treats a missing rate as interest-free
- [PASS] caps the final instalment at the balance plus interest
- [PASS] repays no principal (and holds the balance) when the EMI only covers interest
- [PASS] is all zeros for a paid-off loan

**monthsToRepay**

- [PASS] is balance / EMI rounded up without interest
- [PASS] takes longer with interest
- [PASS] is null when the EMI never covers the interest
- [PASS] is 0 for a paid-off loan

**computeNetWorth with accounts**

- [PASS] adds bank/cash/wallet balances and subtracts credit-card dues

**simulateDebtPayoff with interest and rollover**

- [PASS] counts interest, so a loan at a rate takes longer than balance ÷ EMI
- [PASS] rolls an overpayment on to the next loan in the same month
- [PASS] leaves out a loan whose EMI never covers its interest

**computeFreeMoneyDay**

- [PASS] maps the committed share of income onto the month
- [PASS] uses the length of the month it is given
- [PASS] does not round up past an exact day because of floating-point noise
- [PASS] is day 0 with nothing committed, and every day free
- [PASS] reports over when commitments reach income, and no_income without income
- [PASS] treats a negative commitment total as zero

**splitEqually**

- [PASS] splits evenly when it divides
- [PASS] leaves the leftover paise with the user so the parts add up
- [PASS] gives the whole bill to the user with no friends

**countsTowardBudget**

- [PASS] counts day-to-day spending but leaves out EMIs, cards and investments unless opted in

**computeOverallBudget**

- [PASS] works out what is left and the per-day figure, counting today
- [PASS] warns at 80% and flags over-spending with nothing left per day
- [PASS] has no days left for a month that has ended
- [PASS] gives the whole remainder on the last day of the month

**averageMonthlySavings**

- [PASS] averages the last three full months and ignores the current one
- [PASS] starts at the first month with any activity, so earlier empty months are not zeros
- [PASS] keeps a quiet month after the first one as zero savings
- [PASS] falls back to the current month so far when no full month has activity

### `utils/__tests__/calendar.test.ts` (4)

**calendar helpers**

- [PASS] lays a month out Monday-first
- [PASS] applies min and max inclusively
- [PASS] greys a month only when no day in it can be picked
- [PASS] moves between months across years

### `utils/__tests__/dates.test.ts` (14)

**todayLocalIso**

- [PASS] uses the local calendar date, zero-padded

**isValidIsoDate**

- [PASS] accepts real dates, including a leap day
- [PASS] rejects impossible dates
- [PASS] rejects anything not in strict YYYY-MM-DD form

**shiftIsoDate**

- [PASS] moves across month and year boundaries
- [PASS] handles a leap-year February

**monthYearOf**

- [PASS] splits a date into month and year

**entryDateError**

- [PASS] allows today and past dates
- [PASS] rejects a future date
- [PASS] rejects a malformed or impossible date

**shiftMonth**

- [PASS] steps back and forward within a year
- [PASS] rolls over year boundaries in both directions

**recentDateLabel**

- [PASS] says today and yesterday, and otherwise the day and month
- [PASS] handles yesterday across a month and year end

### `utils/__tests__/expenseReports.test.ts` (22)

**changePct**

- [PASS] rounds the change from the previous value
- [PASS] has no value when there is nothing to compare with
- [PASS] writes the sign

**monthlyExpenseRows**

- [PASS] lists months newest first with the change against the month before
- [PASS] finds the average and the highest month over the months listed
- [PASS] scales bars to the highest month
- [PASS] keeps months with no expenses as 0 and hides the change after one
- [PASS] copes with no spending at all
- [PASS] can list every month when the series has no baseline

**categoryRows**

- [PASS] adds up to the period total, folding the smallest into Others
- [PASS] works out shares and bars
- [PASS] puts categories the app does not know under Others, even a big one
- [PASS] compares each row with the previous period, Others included
- [PASS] has no change for a category that had nothing before
- [PASS] is empty for a period with no expenses

**topSpendInsight**

- [PASS] names the top category and how it moved
- [PASS] leaves the change out when there is none to report
- [PASS] skips Others as the top spend, and says nothing without expenses

**categoryByMonth**

- [PASS] adds one category month by month, expenses only, with empty months as 0

**categoryPeriod**

- [PASS] compares a month with the month before, across a year end
- [PASS] compares the year so far with the same months last year
- [PASS] compares a finished year with the whole year before

### `utils/__tests__/issues.test.ts` (5)

**base64ByteLength**

- [PASS] matches the real decoded size for every padding case
- [PASS] ignores a data: URL prefix and whitespace
- [PASS] puts exactly 2 MB at the limit and one byte more over it

**issue API calls**

- [PASS] posts a report with a long upload timeout and returns the saved row
- [PASS] fetches the user's own reports

### `utils/__tests__/people.test.ts` (15)

**fmtAmount**

- [PASS] shows whole rupees without paise, and paise when present
- [PASS] is always positive: the words carry the direction

**balanceLabel**

- [PASS] says who owes whom in words

**filterPeople**

- [PASS] filters by direction and overdue

**shortDate**

- [PASS] leaves out the year when it is this year
- [PASS] adds the year otherwise

**planPeopleSplit**

- [PASS] shares equally between friends and you
- [PASS] keeps the leftover paise with you
- [PASS] counts a typed new name as one more person
- [PASS] uses typed amounts for a custom split, and your share is the rest
- [PASS] reads a custom share typed with commas as the whole number, not the digits before the comma

**peopleSplitProblem**

- [PASS] asks for an amount and for people first
- [PASS] accepts a normal equal split
- [PASS] refuses an amount too small to split
- [PASS] needs every custom share, and not more than the total

### `utils/__tests__/planState.test.ts` (11)

**words**

- [PASS] says when something ends
- [PASS] writes the price and short dates

**the Home strip**

- [PASS] says nothing until the plan is enforced, or without a plan
- [PASS] says nothing to someone with plenty of time, a company account, or an open-ended exception
- [PASS] warns in the last 30 days, with the date and the price
- [PASS] after it ends, says the data is safe and asks to renew
- [PASS] while a payment is being checked, reassures instead of asking to pay
- [PASS] tells a paid user their plan is ending, and that renewing early loses no time
- [PASS] warns an exception holder only in the last 14 days

**the Your plan headline**

- [PASS] describes each state

**who can pay**

- [PASS] everyone with the plan switched on, except company accounts

### `utils/__tests__/repeatEnd.test.ts` (7)

**repeat end date**

- [PASS] counts presets from the base date, clamping to short months
- [PASS] previews the entries a repeat adds
- [PASS] leaves out the last month when the repeat day falls after the end date
- [PASS] handles quarterly, yearly and an end before the first entry
- [PASS] requires a choice and a usable date
- [PASS] builds the request fields
- [PASS] labels a rule by its end

### `utils/__tests__/theme.test.ts` (21)

**light tokens**

- [PASS] ink text is at least 4.5:1 on bg and surface
- [PASS] inkSoft text is at least 4.5:1 on bg and surface
- [PASS] inkMuted text is at least 4.5:1 on bg and surface
- [PASS] brand text is at least 4.5:1 on bg and surface
- [PASS] positive text is at least 4.5:1 on bg and surface
- [PASS] negative text is at least 4.5:1 on bg and surface
- [PASS] warning text is at least 4.5:1 on bg and surface
- [PASS] info text is at least 4.5:1 on bg and surface
- [PASS] violet text is at least 4.5:1 on bg and surface
- [PASS] on-brand text is at least 4.5:1 on brand and brandDeep

**dark tokens**

- [PASS] ink text is at least 4.5:1 on bg and surface
- [PASS] inkSoft text is at least 4.5:1 on bg and surface
- [PASS] inkMuted text is at least 4.5:1 on bg and surface
- [PASS] brand text is at least 4.5:1 on bg and surface
- [PASS] positive text is at least 4.5:1 on bg and surface
- [PASS] negative text is at least 4.5:1 on bg and surface
- [PASS] warning text is at least 4.5:1 on bg and surface
- [PASS] info text is at least 4.5:1 on bg and surface
- [PASS] violet text is at least 4.5:1 on bg and surface
- [PASS] on-brand text is at least 4.5:1 on brand and brandDeep

**withAlpha**

- [PASS] converts a hex colour to rgba

### `utils/__tests__/txnLink.test.ts` (4)

**txnLink**

- [PASS] finds a month's first and last day, including leap February
- [PASS] spans a range of months and labels it
- [PASS] builds the link with only the filters that were given
- [PASS] reads the filters back, and treats a plain open as no filter
