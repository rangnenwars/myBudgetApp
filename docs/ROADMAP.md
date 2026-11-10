# Prapanji roadmap — money app for everyone, student-friendly

Status: **in progress** · drafted 2026-10-04 · progress last checked 2026-10-16 · replaces the old parent/student PLAN.md

## Progress

Keep this section up to date whenever an item is built, committed or changed.

| Item | Status | Notes |
|------|--------|-------|
| A1 Generic categories | **Partly done, committed** (`30de1df`) | The family-specific categories are gone, and a migration gives each existing user a private copy of the ones they used. Still missing: new general categories (Rent, Eating out, Salary/Pocket money, student fees). The outcome of running the migration on production (runbook 5.3) hasn't been confirmed. |
| A2 Category packs | Not started | |
| A3 Simple / Full mode | **Replaced** by admin-driven feature access. **All three parts built and committed** (2026-10-06) | Admin (and system_manager) switches Goals, Loans and Investments on or off per user; support can only view. Home, Transactions, Reports, Budgets, Accounts, Input expenses and People are always on. Sign-up defaults are editable by admin. Existing users keep only features they already have data for. A hidden feature leaves net worth, reports and free-money day, and its server routes refuse access; data is kept. Users see only their tabs, with a "Request access" button that feeds the issue flow. Wireframes A, B, C1, C2 approved, with "Waiting requests" on the admin Features page. Part 1: `user_features` + `app_settings` tables (migration 0020), `requireFeature` on goals/loans/investments and their two reports, `/features` and `/admin/features` endpoints, `features` on `/auth/me`; loan EMIs keep posting while Loans is off. Part 2: tabs for Goals, Loans and Investments appear only when switched on; opening a hidden one shows "isn't on for your account" with **Request access** (`components/FeatureGate.tsx`); Reports and the free-money day leave out hidden features. Checked in the browser against the local server. Part 3: staff screens. A **Features** section on each user's sheet (Users screen, admin and support see it, only admin switches); a **Feature access** page (`app/admin/features.tsx`, reached from the Users screen header or System metrics) with the sign-up defaults, **Waiting requests** with Switch on / Decline, and who has what; the audit log names the new actions. Checked in the browser with a throwaway admin. System managers have no Users screen, so they answer requests from the Feature access page. |
| Plan ahead (next 12 months) | **Built and committed** (2026-10-31) | Wireframes approved. A fourth admin-switched feature (`forecast`, migration 0022; existing users with a repeating entry get it on). `GET /forecast` (`server/src/lib/forecast.ts`, read-only) projects repeating income and bills, loan EMIs and an average of the last 3 full months' spending, leaving out rule-posted bills and EMIs so nothing counts twice. App: Home card (`components/PlanAheadCard.tsx`), year view and month detail (`app/plan-ahead/`), Reports link. Planned one-offs and per-category future budgets are not built. |
| More features (discovery + paid access) | **Built and committed** (2026-10-31) | Wireframes approved. `/more-features` page (Home line "Explore more features", Settings row) lists Goals, Loans, Investments and Plan ahead with a Pro badge, price and Request access. Prices live in `constants/features.ts` (all 0 = free for now). A priced feature opens a request sheet: pay by UPI (`PAYMENT_UPI_ID` env on the server), then "I've paid, send request". Admin Waiting requests shows "says they paid" and a Switch on for 1 month / 1 year / No end choice. Migration 0024 adds `user_features.expires_at` and `request_paid`; an ended period counts as off at read time (no job), data kept. Deviation from the wireframe note: ended access is switched off (hidden), not read-only. In-app payment (Razorpay/UPI) is not built. |
| Transactions: Today / This month tabs | **Built, not committed** (2026-11-09) | Two slim tabs under the Transactions title show expenses today and this month (all entries of type expense, as in Reports). Tapping one lists only that period, tapping again clears it, and a date range that came from Home or Reports is replaced by the tab. Both totals reload after every add, edit and delete, and when the screen is shown again. No server change: it reads the existing `GET /transactions/page` summary (test added in `budgetsAccounts.test.ts`). |
| A4 First-run setup | Not started | |
| A5 Remove Pro leftovers | Not started | The Pro/Standard chip is still on Home, and `ProGate` still shows "Try Pro (test mode)". |
| B1 Quick-add | **Built and committed** | A sheet opened from Home (`components/QuickAddSheet.tsx`) with a keypad and the 4 most-used categories. It isn't a centre ＋ tab, and it has no account picker until B6. |
| B2 Safe-to-spend | **Built as "Free-money day", committed** | The card and screen (`components/FreeMoneyCard.tsx`, `app/free-money-day.tsx`, migration 0015) show the day of the month by which your fixed bills are covered. A "₹X/day" figure now comes from the monthly budget (B5), not from payday. **Calculation audit fixes (2026-10-06, committed):** income is the 3-month average with no-income months counted as zero (a small repeating income no longer hides a hand-logged salary); EMIs still posting while Loans is off still count; repeating Loan EMI entries are blocked (no double counting); repeating quarterly/yearly bills are stored in full, not ÷3/÷12. **Second audit (2026-10-31, committed):** the income average now starts at the earliest of the last 3 months in which the user logged anything (an old backdated entry no longer stretches it), skips a first month with no income (a part-month start), and "last week" is compared only with last week's own reading, never an older one. Three new tests in `server/src/__tests__/splitFreeMoney.test.ts`; not fixed: transfers between own accounts count as income until B6. |
| B3 Upcoming bills | Not started | |
| B4 Day / Week / Month view | Not started | Part of the planned "weekly review" (with Phase D look-back). Plan first, approval before building. |
| B5 Budgets → **one monthly budget** | **Built and committed** (2026-10-06) | Re-scoped by the owner: instead of per-category or weekly budgets, one overall monthly budget (e.g. ₹15,000) with optional category limits inside it. EMIs, credit-card bills and investments excluded by default (switch to include). No carry-over. Budgets screen shows total, category limits, "Everything else"; Home shows "₹X left · about ₹Y/day" above the free-money card (`components/BudgetCard.tsx`, `GET/PUT/DELETE /budgets/overall`, migration 0019). Weekly split of the budget not built. |
| B6 Transactions ↔ accounts, transfers, prepaid cards | Not started | |
| C1 Goal templates | Not started | |
| C2 Lent & borrowed (People) | **Slices 1–2 built and simplified; committed (2026-10-06)** | Home has one People button (with totals). People has two buttons: **Split a bill** (own simple page, paid by me, equal or changed amounts) and **Lent or borrowed**, plus per-person history, part payments, due dates, write-off, undo (migrations 0017–0018). The Split switch was removed from Add transaction and Quick add; splitting one payment across categories is **parked** (API only, `POST /transactions/split`). Still to do: slice 3 (remind message + UPI link), slice 4 (invite flow F/G/H, approved). |
| C3 Event & term budgets | Not started | |
| Phase D Habits | Not started | The weekly look-back became a **monthly review** (2026-11-09). AI insights are parked in the Backlog section. |
| Phase E Later | Not started | Deferred by design. |
| Repeat "Ends on" | **Built and committed** (2026-10-11) | Every repeating entry now needs an end: 3, 6 or 12 months, a picked date, or an explicit **No end date** (wireframe approved). After the end date the rule posts nothing more, drops out of the Repeating list and of the free-money day; entries already posted stay, so reports count only up to the end (a monthly repeat ending in July = 7 months). Catch-up never posts past the end date. Old rules keep posting and show "needs an end date" until the user chooses. Migration 0021 (`ends_on`, `no_end`); optional bulk helper `server/scripts/repeat-end-backfill.sql`. `components/RepeatEndField.tsx`, `utils/repeatEnd.ts`. Not yet checked in the browser. |
| Calendar picker | **Built for every date field and committed** (2026-10-11) | A real calendar in a bottom sheet beside the typed `YYYY-MM-DD` box (wireframe approved). Built for the transaction date (no future days) and the repeat "Ends on" date (nothing before the first entry). Month grid, Today / Cancel / Done, tap the month name to jump by month and year. Plain components, because the Expo SDK 57 datetimepicker has no web support (`components/CalendarSheet.tsx`, `utils/calendar.ts`). Then extended to the other date fields with one shared typed-box-plus-calendar-button (`components/DateInput.tsx`): the lent/borrowed pay-back-by date (nothing before today), the goal target date (nothing before today) and the loan start date (any date). Investments has no date field in the app today (start date is set automatically, maturity date is unused). Checked in the browser for the transaction date, Ends on, Goals and Loans; the pay-back-by date uses the same component but wasn't clicked through. |
| Loan payments history | **Built and committed** (2026-10-31) | Wireframe approved. Each loan card shows "Paid so far: ₹X in part payments" and a **Payments** button that opens a page (`app/loan-payments.tsx`) listing part payments and EMIs, newest first, with the balance after each. New table `loan_payments` (migration 0023); written by part payments, "Mark EMI paid" and the monthly auto-posted EMI, for loans that count as an expense and those that don't. The migration backfills old part payments from their transactions (one loan per name only, balance blank). `GET /loans/:id/payments`, `part_paid` on `GET /loans`. Checked in the browser with a throwaway user. Not recovered: part payments on loans that don't count as an expense (never logged), and old EMIs (history starts now). |
| Amount entry + average fixes | **Built and committed** (2026-10-31) | From the arithmetic audit. (1) One `parseAmount` (`utils/amount.ts`) now reads every money field, so "1,00,000" or "₹1,200.50" is read whole instead of as ₹1; "50k" or "12.50.3" is refused with the usual message (Input expenses now says so instead of skipping the row). (2) Goal dates use `averageMonthlySavings`: last 3 full months from the first with activity, not the half-finished current month or months before the user started. (4) The budget suggestion counts a month with no spending as zero. Tests: `utils/__tests__/amount.test.ts`, `calculations.test.ts`, `people.test.ts`, `server/src/__tests__/reports.test.ts`, `budgetsAccounts.test.ts`. Not fixed: non-counted loans' "Mark EMI paid" ignores the interest rate. |
| Login marketing slides | **Built and committed** (2026-10-31) | Wireframe approved. Five auto-advancing slides (Built for everyone, Parents, Better choices, Asha/Ravi example, Start young) sit left of the sign-in/register form on screens 900px wide or more; on narrow screens they become a short strip under the green header. Skips auto-advance if the browser asks for reduced motion. Each slide has a flat SVG illustration on wide screens only (wireframes for slides 1 and 4 approved; 2, 3 and 5 drawn in the same style, `components/ui/AuthSlideArt.tsx`). Slide 4's study line is general (no number or named source); add one if a real study is chosen. `components/ui/AuthSlides.tsx`, `components/ui/AuthSlideArt.tsx`, `components/ui/AuthLayout.tsx`, `components/ResponsiveContainer.tsx`. Checked in the browser at desktop and phone width. |
| Tap-through to the entries (slices 1 and 2) | **Built, not yet committed** (2026-11-05) | Wireframe approved. Slice 1: Home Income, Expense and top categories, and Reports category rows and trend points, open Transactions already filtered (category, month or range, type) with removable chips, a **Back** link, **Clear all** and a "12 entries · ₹8,420" line (`utils/txnLink.ts`; the page endpoint now returns a first-page `summary`). Slice 2: a fixed bill on Plan ahead's month screen or the free-money day opens its **Edit repeating entry** sheet; a loan EMI opens the Loans tab scrolled to that loan, outlined (`components/useOpenBill.tsx`; forecast and free-money lines now carry `id`). Tabs use history back-behaviour. Slice 3 (Reports totals to a loan or investment) not started. |
| F-01 Month-wise expenses | **Built, committed on `feature/f01-monthly-expenses`** (2026-11-09) | From BACKLOG.md. Reports has a **Overview | Monthly | Categories** switch and opens on **Overview** (the original screen): last 12 months with a bar and % change (hidden when the month before is 0, ₹0 months kept), tap a month for its categories (top 3 + Others) and "See all transactions" (filtered Transactions). Home "This month" card opens it. Totals come from the existing monthly series and category breakdown; `utils/expenseReports.ts` only does percentages, bars and Others. Not yet pushed or opened as a PR. |
| F-02 Categorised expenses | **Built, committed on `feature/f02-categorised-expenses`** (2026-11-09) | From BACKLOG.md; builds on F-01. Reports > **Categories** (Month or Year, with a period picker): total, a one-line insight from simple rules, categories by amount with share, bar and % change against the previous period (same months last year for the current year), top 5 plus Others. Month: tap a category for its filtered transactions. Year: tap for a month-by-month screen (`app/category-trend/[category].tsx`) and a See transactions button. Split bills count only the user's share (existing behaviour, now covered by a test). Not yet pushed or opened as a PR. |
| Home slimmed to 7 blocks | **Built, committed on `ux/home-slim`** (2026-11-09) | Wireframe approved (merged "gentler" version, with Top expense categories and Pro insights kept). This month and Budget merged into one hero card (budget left and per day, spent and % change; set-a-budget when none); one alert strip (email and budget alerts, only when needed); the money-left card gets a Plan ahead link and the separate Plan ahead card is gone; Income/Expense/Net is one strip; the breakdown moved to Reports; new Recent transactions (3 rows); Top categories gets All categories. `components/HomeHeroCard.tsx`, `components/RecentTransactions.tsx`. |
| Operator console (separate app) | **Design drafted, wireframes awaiting approval** (2026-11-09) | See [OPERATOR_CONSOLE_DESIGN.md](OPERATOR_CONSOLE_DESIGN.md). Solo owner, separate web app, no "view as user". Separate `operators` table with MFA, sessions and audit log; moves the admin/support/system_manager roles out of `users`. Nothing built. |
| Delete a part payment (Loans, Payments) | **Built on `feature/loan-payment-delete`, not yet merged** (2026-11-10) | A bin icon on each part payment (no EMIs) with a one-line confirm. Undoes everything in one step: balance, EMI, the expense entry (linked by migration 0026; older payments matched by note, amount and date), and the later rows' balances. Branched from `feature/paid-access`, so migration 0026 follows 0025. |
| Paid plan: 6 months free, then ₹200 a year | **Built, committed on `feature/paid-access`** (2026-11-09) | Wireframes approved. One access rule on the server (company account, exception with optional date, paid period, 6-month trial from each account's own sign-up, 3-day hold while a payment is checked). Shadow mode first: nothing is locked until an admin sends the notice to existing users and turns it on (password each time, rollback any time). Users pay by QR or UPI ID and send a screenshot plus transaction ID; an admin confirms receipt (adds a year after the current end). Admin: plan and pricing, payment details (QR read and matched to the UPI ID, password, every admin emailed), payments to confirm, exceptions list, company accounts, per-user feature toggles, ending-soon list. Welcome, notice, reminder (30/7/1 days, ended) and receipt emails, each sent once. See `docs/PAID_PLAN.md`. Automatic bank or gateway matching and app-store billing are not built. |
| UX pass | In progress | Built 2026-10-16 (wireframes approved): People buttons moved to the top, Home card order (budget, money-left, People/Accounts, breakdown, then Income card), "Money left after fixed bills" Home card, payoff and goal dates on Reports. Not committed yet. The other rows in the UX table below are still open. |

**Waiting on the owner:** approval of the optional-features wireframes, answers to "Questions for you" at the end of this doc, and a wireframe approved before any UI change.

## Direction

- **Audience:** anyone managing their own money. Students are one supported profile, not the only one.
- **Student features stay**, but as options: a student category pack, prepaid campus cards, term budgets and goal templates. They are offered at setup, not forced on everyone.
- **Every existing screen gets friendlier:** fewer taps, plain words, no raw date typing, no accidental deletes.
- **Not building:** parent accounts, parent/student linking, or a Student/Parent toggle. OTP login stays deferred, so login is email + password.
- **Money format:** stays `numeric(12,2)` as today. The spec's integer-paise rule is dropped because changing every money column has no user benefit.
- **Look:** layouts stay as they are. The visual changes are limited to the colour tokens already done.

## Key findings from reading the code

1. **The built-in categories belong to one family.** Examples: `rashmi_darsh`, `gaju_sasur`, `kunal`, `mandawa_kinwat_maintenance`, `hdfc_cc`/`sbi_cc`, and location-named chit funds. Every new user would see these. This is the biggest blocker to a general audience.
2. **Transactions aren't linked to accounts.** Account balances are typed in by hand ("Update balances whenever you check your bank app").
3. **There are 6 bottom tabs.** Loans and Investments take up tab space even for people who never use them.
4. **Pro is now on for everyone** (migration 0013), but Home still shows a Pro/Standard chip and 12 `ProGate` wrappers.
5. **Some dates are typed by hand as `YYYY-MM-DD`:** the goal target date and the loan start date. `DateField` already exists but isn't used for them.
6. **Accidental deletes are easy.** Every transaction row has a trash icon, and Sign out sits next to Settings in the Home header.
7. **The transaction form has two similar controls.** "Period" (spread a quarterly or yearly bill into a monthly amount) and "Repeat" sit side by side and are easy to confuse.

---

## Phase A — Foundation (needed before anyone new signs up)

| # | What | Changes |
|---|------|---------|
| A1 | **Generic category set.** Replace the family-specific system categories with general ones (Rent, Groceries, Eating out, Transport, Bills & recharge, Health, Education, Shopping, Entertainment, Gifts, Salary, Pocket money/allowance, Freelance, Interest…). A migration moves each old category, with its transactions, budgets and repeating rules, into a **custom category owned by the user who used it**. Nothing is lost and labels stay the same for the existing user. | `constants/categories.ts`, new migration 0015, `server/src/routes/categories.ts`, tests |
| A2 | **Category packs** that can be added at setup or later in Settings: **Student** (Canteen/mess, Food delivery, Hostel/PG rent, Books & stationery, College fees, Fest & outings, Recharge), **Household** (Maid, Electricity, Milk, Property tax…), **Vehicle** and **Small business**. A pack adds normal custom categories, so they can be renamed or removed. | `constants/categoryPacks.ts`, new `POST /categories/packs/:id`, Settings |
| A3 | **Simple / Full mode.** A per-user setting with simple as the default for new users. Simple mode hides Loans, Investments and Input expenses but keeps their data. Tabs become **Home · Transactions · ＋ · Goals · More**, where More holds Reports, Budgets, Accounts, Loans, Investments and Settings. | `users.mode` column, `app/(tabs)/_layout.tsx`, new `app/(tabs)/more.tsx`, Settings toggle |
| A4 | **First-run setup**, three screens, all skippable: (1) "What fits you best?": Student / Working / Home manager / Self-employed, which picks a category pack and suggested mode; (2) monthly income or pocket money and the day it usually arrives, saved as a repeating income; (3) a first goal from templates (C1). | new `app/onboarding/*`, `users.onboarded_at` |
| A5 | **Remove Pro leftovers.** Hide the tier chip, make `ProGate` render its children, and remove "available on Pro" copy. The `tier` column is kept so Pro can come back later. | `components/ProGate.tsx`, Home, Goals, Reports |

## Phase B — Everyday use

| # | What | Changes |
|---|------|---------|
| B1 | **Quick-add (centre ＋ tab).** Opens to a large amount field with the number pad up and a row of most-used category chips (default chips come from the user's pack). Note and account are optional, and the account defaults to the last one used. Save shows a toast: "₹60 on Canteen · ₹840 left this week". The full form stays in Transactions. | new `app/(tabs)/add.tsx`, `components/AmountInput.tsx`, `components/CategoryChips.tsx`, `GET /categories/frequent` |
| B2 | **Safe-to-spend card on Home:** "You can spend **₹142/day** until 1 Nov (next income)". The calculation is: expected income this cycle (from the repeating income) − spent so far − repeating bills still due before payday, divided by days left. If there's no income rule, it falls back to the weekly or monthly budget. This works the same for a salary or pocket money. | `utils/calculations.ts` (pure function + unit tests), `app/(tabs)/index.tsx` |
| B3 | **Upcoming bills:** a list of the next 7 days of repeating expenses on Home ("Rent ₹8,000 · in 3 days"), each with a "Paid / Skip this time" action. | uses existing `recurring_transactions.next_due`, small `POST /recurring/:id/skip` |
| B4 | **Day / Week / Month toggle** on Home and Transactions. Weeks run Monday–Sunday. The week view shows the total, a bar against the limit, 7 daily bars and the top 3 categories. | Home, Transactions, `GET /reports/summary?from&to` |
| B5 | **Weekly budgets.** Each budget gets a period, weekly or monthly. When setting a weekly limit, the app suggests monthly income ÷ 4.3. | `budgets.period` column, `app/budgets.tsx`, budget status query |
| B6 | **Link transactions to accounts.** Add an optional `account_id`, which updates the account balance automatically on add, edit and delete. Add a "Transfer" between accounts that isn't counted as income or expense. Add a **Prepaid card** account type (mess card, metro card, canteen wallet) with a low-balance warning. | `transactions.account_id`, `accounts.type` + `'prepaid'`, `routes/transactions.ts`, `app/accounts.tsx` |

## Phase C — Goals, people, events

| # | What | Changes |
|---|------|---------|
| C1 | **Goal templates**, one tap each: Emergency fund (target = 3 × average monthly spend), New phone, Laptop, Trip, Course/exam fee, Festival & gifts, Vehicle down payment. Each prefills the name, icon and a suggested date, and shows "save ₹X/month to reach it". | `constants/goalTemplates.ts`, `app/(tabs)/goals.tsx` |
| C2 | **Lent & borrowed (IOUs):** "Rahul owes me ₹200", "I owe Priya ₹500". Each is tracked per person with a running balance, Settle (full or part), a UPI request/pay link (`upi://pay`) and a reminder message to share. The `lending_given`/`lending_received` categories already exist, so this gives them a proper screen. | new `ious` table + `routes/ious.ts`, `app/people.tsx`, Home "You get / You owe" pill |
| C3 | **Event & term budgets:** one limit across a date range, for example a semester, a wedding, a Goa trip or Diwali. Transactions can be tagged to the event, and progress shows on Home while it's active. | `budgets.period = 'custom'` + `start_date`/`end_date`, or a small `events` table (decided at build time) |

## Phase D — Good habits (from spec Feature 3)

- **Monthly review** (replaces the weekly look-back, decided 2026-11-09): on the 1st, a card on Home links to a review of last month. It shows total spent, change against the month before, the 3 biggest category movers, a 6-month trend, the largest single spend and the weekend share, with a history of past months. It's rule-based maths on the user's own transactions, saved once per user and month so past months never change. Wireframes (Home card, review screen, past months) were shown for weekly and need re-showing as monthly for approval before building.
- **Nudges**, at most one a day and shown in-app only (no push yet), each with an on/off switch in Settings: 80% of the weekly limit with 3+ days left; income arrived but nothing added to a goal; no entries for 3 days; an IOU unsettled for 7+ days.
- **Tip library:** 30–50 short tagged tips covering basics for everyone (emergency fund, 50/30/20, EMIs and interest, credit-card minimum-due trap) and student topics (pocket-money planning, education-loan moratorium interest, student discounts).
- **Goal streaks:** consecutive weeks with any goal contribution, with milestones at 4, 12 and 26 weeks. A missed week resets quietly.

## Phase E — Later

- **Group bill splitting** (spec Feature 1). It needs invites and multiple users per group, so it builds on C2's people/settle logic.
- Push notifications (expo-notifications), and OTP login once an SMS provider exists.
- Sharing a UPI receipt into the app to prefill quick-add.

## Backlog (parked, not planned)

- **AI-written insights** (parked 2026-11-09). An LLM (for example `claude-haiku-5-5`, called from the server only) turns the monthly review's computed facts into a short personal summary and one suggestion. Notes for when it's picked up: send aggregates only, never raw merchant names or notes; opt-in toggle in Settings; saved once per user and period; discard the output if its numbers don't match the facts and fall back to the rule-based text; "AI-generated" label with thumbs up/down. Builds on the monthly review, so do that first.

---

## UX pass (runs alongside, one screen at a time)

Step zero: walk through every screen in the browser preview on phone width and add anything new to this list.

| Area | Fix |
|------|-----|
| All forms | Use `DateField` for the goal target date and loan start date instead of typed `YYYY-MM-DD`. |
| All amount fields | Show a ₹ prefix and Indian grouping (1,23,456) while typing; use the numeric keypad. |
| Transactions list | Group by day with headers ("Today", "Yesterday", "Mon 29 Sep") and a day total. Move delete off the row into the edit sheet, followed by an **Undo** toast instead of a confirm dialog. Add pull-to-refresh. |
| Transaction form | Hide **Period** (spread quarterly/yearly) under "More options" and only in full mode. Keep **Repeat** with plain wording: "Comes back every month". |
| Category picker | Most-used first, search box, recent 5 on top. |
| Home header | Move Sign out and Report a problem into Settings; keep Settings as one icon. |
| Empty states | Each has one line plus a real button ("Add your first expense") instead of "Tap + to…". |
| Errors | Show errors next to the field that caused them rather than as one line at the bottom; keep the user's input when a save fails. |
| Goals | "Manage funds" → separate **Add money** and **Withdraw** buttons on the card; show "₹X/month to reach by <date>". |
| Loans | Plain-language labels ("Amount still to repay" instead of "Outstanding"), plus a one-line explainer for snowball vs avalanche. |
| Accounts | Once B6 lands, balances update themselves; manual edit becomes "Correct balance". |
| Accessibility | 44×44 touch targets, `accessibilityLabel` on every icon button, and owe/get amounts always carry a word or sign, not just colour. |

## Suggested order and size

| Step | Scope | Size |
|------|-------|------|
| 1 | A1, A2, A5 + UX pass on Transactions & forms | M |
| 2 | A3, A4, B1 | M |
| 3 | B2, B3, B4, B5 | M |
| 4 | B6 | M (touches balances, needs careful tests) |
| 5 | C1, C2, C3 | M |
| 6 | Phase D | M |

Each step goes on its own branch with tests (server Jest + `utils/__tests__`), a typecheck, and a Docker rebuild to check it.

## Questions for you

1. **Category migration (A1):** OK to turn the current family-specific categories into custom categories on the account(s) that use them? Labels and history stay the same for that account; new users won't see them.
2. **Pro:** remove the Pro/Standard UI completely for now (A5), or keep some features for a future paid tier?
3. **Default mode for new users:** Simple (recommended), or ask at setup?
4. **IOUs (C2) vs group splitting:** is per-person lent/borrowed enough for now, with groups moved to "later"?
5. **Branch:** the current `feature/prapanji-phase-1` has uncommitted theme/login/legal work. Should I commit that first as its own commit, then start step 1 on a new branch?
