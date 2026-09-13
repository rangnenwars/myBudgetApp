# Pro Features, Data/Session Architecture & Reporting Module — Design Doc v1

Status: **mostly built.** Originally written as planning-only; updated after implementation. B1 items 1–6 are done, the `user_id` gap is fixed, and Reports/Debt planner/Goal ETA/Spending insights/CSV export are live behind a local "Try Pro (test mode)" toggle (no real billing exists — see README §2). Still open: App lock (B1.7), the Account & Data settings screen (C2), and everything in B2 (needs a backend). See [README.md](README.md) for the current feature list and [architecture-flows.html](architecture-flows.html) (or the [live version](https://claude.ai/code/artifact/3787e434-ead3-4e0a-881d-119411b2a53d)) for the as-built architecture diagram and test coverage map.

---

## A. Reference research — Ramsey Solutions (EveryDollar)

Pulled from ramseysolutions.com to sanity-check our feature direction against a well-known budgeting product.

**What EveryDollar (their app) does:**
- Zero-based budgeting: plan every dollar before spending, income − expenses = 0
- Free tier: manual transaction entry, custom categories, bill reminders, transaction splitting
- Premium tier ($79.99/yr): bank sync (Plaid/Mastercard Connect), custom spending reports, a "financial roadmap," projected net worth, debt tracker, live coaching
- Debt tracker uses the **debt snowball** method: order debts smallest-balance-first (ignore interest rate), pay minimums on the rest, throw every spare dollar at the smallest, then roll that payment into the next-smallest once it's cleared. They also document **debt avalanche** (highest-interest-first) as the mathematically-optimal alternative, but say snowball wins in practice because of momentum/psychology.
- Sinking funds: dedicated savings buckets inside the budget (conceptually the same thing our Goals tab already does)

**Alignment with what you're asking for:**

| Ramsey feature | Aligns with our plan? |
|---|---|
| Custom spending reports, trend visibility over time | **Yes — directly validates the "reporting module on demand" ask below** |
| Debt snowball tracker with payoff projection | **Yes — upgrade for the Loans tab's Pro insight** |
| Net worth tracking/projection | **Yes — new idea worth adopting, we don't have this yet** |
| Sinking funds | Already covered by our Goals tab, no change needed |
| Bank account auto-sync (Plaid/Mastercard Connect) | **No — out of scope.** Requires a paid third-party data aggregator and a real backend to hold bank credentials/tokens. Also crosses into handling real financial credentials, which this project should not do without a much bigger security review. |
| Live coaching / webinars | **No — human service, not applicable to a solo personal app** |
| Subscription pricing / paywall | **No — not relevant, this is a free personal project** |

Sources: [EveryDollar Budget](https://www.ramseysolutions.com/money/everydollar/budget), [Budgeting App Comparison](https://www.ramseysolutions.com/budgeting/budgeting-apps-comparison), [How the Debt Snowball Method Works](https://www.ramseysolutions.com/debt/how-the-debt-snowball-method-works), [Debt Snowball vs. Debt Avalanche](https://www.ramseysolutions.com/debt/debt-snowball-vs-debt-avalanche)

---

## B. Pro feature list — reviewed

The original spec gated these behind Pro: cloud sync, spending insights, loan/goal ETA, Excel/CSV export, multi-device sync. Reviewed against Ramsey's feature set and against what's actually buildable **without a backend** (since this build stays local-only per our earlier scope decision).

### B1. Buildable now (no backend needed)

| # | Feature | Status | What it does | Notes |
|---|---|---|---|---|
| 1 | **Reports & trends module** | ✅ Built | Summary dashboard + on-demand trend charts (income/expense/savings/net worth over time, category breakdown, month-over-month deltas) | New Reports tab, `app/(tabs)/reports.tsx` |
| 2 | **Net worth tracker** | ✅ Built | `investments.current_value + goals.saved_amount − loans.outstanding`, tracked as a monthly snapshot so it can be charted over time | `computeNetWorth` + `net_worth_snapshots` table |
| 3 | **Debt payoff planner** | ✅ Built | Orders loans using debt snowball (smallest balance first) or debt avalanche (highest interest first, user's choice), projects a payoff date per loan assuming current EMI, shows "what if I add ₹X extra/month" | `simulateDebtPayoff`, Loans tab footer |
| 4 | **Goal ETA projection** | ✅ Built | Projected completion date per goal from the user's trailing 3-month average savings rate | `computeGoalETA`, Goals tab footer |
| 5 | **Spending insights** | ✅ Built | Month-over-month % change per category, "fastest-growing category" callout | `computeCategoryDeltas`, Dashboard Pro insights |
| 6 | **CSV export** | ✅ Built | Export transactions (any range) as a `.csv` file, generated and saved entirely client-side (`expo-file-system` + `expo-sharing` native, Blob download web) | Reports tab "Export CSV" button |
| 7 | **App lock (security)** | ⬜ Not built | Optional PIN/biometric re-entry after N minutes of inactivity, via `expo-local-authentication` | Not in the original spec — still a good next add for a finance app |

### B2. Needs a backend later (stays locked for now)

| # | Feature | Why it needs a server |
|---|---|---|
| 8 | Multi-device cloud sync | Requires an account that exists outside one device |
| 9 | Bank account auto-import | Requires Plaid/similar aggregator + secure credential storage server-side |
| 10 | Server-computed budget class | Spec explicitly requires this to be server-side; currently a local estimate |
| 11 | Excel (.xlsx) export | Spec's version runs `exceljs` server-side; CSV (B1.6) covers the same need without a server |

**Recommendation:** build B1 (1–7) now. That's a full, coherent Pro tier that works entirely offline and doesn't touch the "needs backend" problem at all.

---

## C. User data management & administration design

Important framing: with no backend, there is no "administrator" overseeing multiple people's accounts — each device/browser has its own isolated local data. "Administer users" in this context means **local account & data management**, not a multi-tenant admin portal (that's spec's Admin role, explicitly out of scope, would need the backend from part B2).

### C1. Data lifecycle (per local account)

```
Register → account row created (user_profile)
  → all activity (transactions/loans/investments/goals) is NOT scoped by user_id today — see gap below
Login → session pointer written to AsyncStorage
Logout → session pointer cleared; local data untouched (per spec rule: never delete on logout)
Delete account → explicit, separate action; wipes that account's row + (once scoped) their data
```

**Gap found while designing this — now fixed:** the schema's `transactions`, `loans`, `investments`, and `savings_goals` tables had **no `user_id` column** — they were global to the device, not per-account. Fixed: `user_id` is now on all four tables (plus `net_worth_snapshots`), every read is filtered by the active session's user id, and every mutation checks it too.

### C2. Proposed "Account & Data" settings screen (new, not built yet)

A settings tab or a screen off the Dashboard, with:
- **Profile** — name/email (edit)
- **Switch account** — if multiple local accounts exist on this device, pick between them without re-typing a password each time (still requires the password, just lists known emails as a convenience)
- **Export all data** — full JSON backup (all tables, this account only) to a file
- **Import / restore** — load a previously exported JSON backup
- **Reset app data** — wipe everything for this account (with a confirmation step, matching the "irreversible action" caution used elsewhere)
- **Delete account** — removes the account row and all associated data
- **App lock** — toggle PIN/biometric requirement (ties into B1.7)

### C3. Session design

Current: a session is just `{ userId }` written to AsyncStorage under `@budget/session`, checked on app launch, cleared on logout. No expiry — matches the spec's "local data never deleted, offline-first" intent, but there's currently no notion of a session timing out at all, which is fine for a personal offline app but worth being explicit about:

- **Proposed:** keep sessions indefinite by default (no forced re-login — this isn't a shared device use case), but let **App lock** (B1.7) provide the actual security boundary: require Face ID / fingerprint / PIN after N minutes backgrounded, independent of the underlying session token. This matches how most personal finance apps (mobile banking, EveryDollar itself) handle it — you stay logged in, but the app re-locks itself.
- If multi-device cloud sync (B2.8) is ever built, *that's* when real JWT expiry/refresh (per the original spec) becomes necessary, because at that point a session actually represents trust with a remote server.

---

## D. Reporting module design

This is the direct answer to "reporting module to showcase summary dashboard and data trends on demand."

### D1. Structure

New **Reports** tab (Pro-gated), separate from the existing Dashboard (which stays as the free, current-month-only snapshot):

- **Time range picker:** This month / Last 3 months / Last 6 months / This year / All time / custom range
- **Summary row:** total income, total expense, net savings, savings rate %, net worth — for the selected range
- **Trend chart:** line chart, metric selectable (income / expense / net savings / net worth), plotted per month across the selected range — this is where `react-native-chart-kit` (already installed, currently unused) finally gets used
- **Category breakdown:** donut/pie for the range, plus a ranked list with month-over-month delta arrows
- **Debt payoff progress:** stacked bar or line showing outstanding balance trending down per loan
- **Goal progress overview:** all goals' % complete side-by-side
- **Export:** "download this report as CSV" button (ties into B1.6)

### D2. Data layer additions needed

New aggregate query functions (both `database.ts` and `database.web.ts`), all "on demand" — computed live from local data, nothing pre-materialized except the net worth snapshot:

- `getRangeSummary(startMonth, startYear, endMonth, endYear)` — income/expense/savings for an arbitrary range
- `getMonthlySeriesForRange(...)` — one row per month, for charting
- `getCategoryBreakdownForRange(...)` — range version of the existing month-only function
- `recordNetWorthSnapshot()` — called on Dashboard/Reports focus, writes one row/month to a new `net_worth_snapshots` table (needed because net worth is a point-in-time figure, not derivable retroactively from transactions alone once loan/investment values change)

---

## E. Suggested build order

1. ✅ Fix the `user_id` scoping gap (C1)
2. ✅ Reports module data layer + Reports tab (D)
3. ✅ Net worth tracker (B1.2)
4. ✅ Debt payoff planner (B1.3) + Goal ETA (B1.4) + Spending insights (B1.5)
5. ✅ CSV export (B1.6)
6. ⬜ Account & Data settings screen (C2) + App lock (B1.7) — still open

## F. Also built (outside this doc's original scope)

- **Input Expenses page** (`app/input-expenses.tsx`) — bulk category+amount entry mirroring the source Excel, with a Monthly/Quarterly/Yearly period selector (quarterly/yearly amounts are divided to a monthly-equivalent before being logged) and automatic Expense/Loan/Investment bucketing by category group (`bucketForGroup`). Added mid-build per direct request; not in the original A–E plan.
- **"Try Pro (test mode)" toggle** — since there's no payment processor, `ProGate` now lets you flip your own account to Pro locally to actually reach and test everything in B1, rather than the Pro tier being built-but-permanently-invisible.
- **Testing framework** — Jest + `jest-expo`, 47 tests at 100% line/function coverage on `utils/calculations.ts`, gated via `npm run quality`.
- **`Alert.alert` web fix** — see README §2 "Known deviations."
- **Docker deployment** — `Dockerfile` + `nginx.conf` + `docker-compose.yml`, static web export served via nginx for local "production-like" testing. See README §7.
