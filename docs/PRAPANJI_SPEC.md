<!-- Extracted from 'Prapanji - Build Spec for Claude Code.docx' (2026-10-04). Tables flattened to lines. -->
Prapanji — Build Spec for Claude Code
Oct 4, 2026 · @Shiva
How to use this spec
Hand this whole document to Claude Code inside the existing My Budget repo and ask it to build Phase 1 first. Everything below adds to the current app; nothing existing is rewritten unless a section says so.
Suggested opening prompt for Claude Code:
Read PRAPANJI_SPEC.md fully. Then inspect this repo: stack, folder layout, routing,auth, database/ORM, API style, test setup. Write a short PLAN.md that maps eachPhase 1 item in the spec to the files you will add or change. Stop and wait formy OK before writing code.
Ground rules for Claude Code:
Inspect before building. The current routes (/(tabs)/transactions, /(tabs)/loans) suggest Expo Router on React Native. Confirm the stack and follow the repo's existing patterns, libraries and naming. Do not introduce a new state library, ORM or UI kit.
Extend, don't replace. Reuse the existing Transactions, Accounts, Budgets, Goals and Reports models. New features link to them.
One phase per branch. Small commits, each with tests. Run lint and the full test suite before saying a phase is done.
Money is integer paise. Store every amount as an integer in paise (₹1 = 100). Never use floats for money. Display with Indian digit grouping (₹1,23,456.50).
No real secrets in code. OTP provider keys, UPI handles and SMS gateway credentials come from environment variables, with a fake provider for local dev and tests.
Ask when the spec is silent. If a decision isn't covered here, write the question in PLAN.md instead of guessing.
Product and starting point
Prapanji (prapanji.in) turns the existing single-user My Budget app into a personal money app for anyone managing their own budget, with Indian college students as the first audience. Prapanji means ledger in Sanskrit. Tagline: Nothing forgotten, nothing hidden. Hindi line: कुछ छूटे ना, कुछ छुपे ना.
The hook is bill splitting with friends. Students stay for daily tracking. The long-term goal is teaching money habits early.
Area
Already built
Status for Prapanji
Auth
Email + password, register, forgot/reset, confirm email
Keep; add mobile OTP as primary
Dashboard
Month arrows, income − expense = net, top 5 categories, budget alerts
Keep; add Split balance card and week view
Transactions
Add/edit/delete, custom categories, repeating entries, search, 50 per page
Keep; add quick-add and student categories
Input expenses
Monthly/quarterly/yearly rows, divided to monthly
Hide in simple mode
Accounts
Bank, Cash, Wallet/UPI, Credit card
Keep as is
Budgets
Monthly limit per category, 80% yellow, 100% red
Add weekly limits
Goals
Target, deadline, contributions, history, ETA (Pro)
Base for streaks
Loans, Investments
EMI, part payment, planner, portfolio
Hide in simple mode
Reports
Pro only; trends, donut, CSV export
Basic weekly report free for students
Settings
Change password, download data, sign out everywhere, delete account
Add mobile number, UPI ID and nudge settings
Admin
Users, roles, tiers, audit log, metrics
Extend audit log to consent events
Not in the app today: bill splitting, OTP login, daily/weekly views, and any teaching features. Those are the three features below.
Design system
The look is calm and trustworthy: deep ledger green, warm off-white paper, one saffron accent used sparingly. It matches the approved login prototype. Put these tokens in one theme file and replace hard-coded colours as screens are touched.
Colour tokens
Token
Light
Dark
Use
brand
#0F5C4A
#3FA98C
Primary buttons, header band, active tab
brandDeep
#0A3F33
#2C8A71
Pressed states, links on hover
accent
#E8892B
#F0A050
Highlights, streak flame, one per screen max
bg
#F5F6F2
#0E1714
Screen background
surface
#FFFFFF
#16221E
Cards, inputs, sheets
ink
#14251F
#E8EEEA
Primary text
inkSoft
#44544E
#A9B7B1
Body copy
inkMuted
#5A6862
#8A9993
Captions, hints
line
#C9D1CB
#2A3833
Input borders, dividers
positive
#1B7F4E
#4CC38A
You are owed, income, under budget
negative
#B3261E
#F2857D
You owe, over budget
warning
#A35A00
#F0B860
80–100% of budget
Owed and owe amounts also carry a word ("you get" / "you owe") or an arrow, never colour alone. White text only sits on brand or darker; check 4.5:1 contrast for all body text.
Type
Display and headings: Space Grotesk 700, sizes 30 / 26 / 20.
Body and UI: DM Sans 400/500/700, sizes 17 / 15 / 13.
Hindi and other Devanagari text: Hind 400/500, fallback Noto Sans Devanagari.
Amounts: DM Sans 700 with tabular figures so columns line up.
Spacing, shape and touch
4-point scale: 4, 8, 12, 16, 20, 24, 28, 32. Screen side padding 20–28.
Corner radius: inputs 12, buttons and cards 14, sheets 20, chips full.
Touch targets at least 44×44. Primary button height 54, secondary 52.
Icons: one outline icon set at 1.75–2 px stroke. No emoji in the UI.
Core components
Primary button (brand fill, white bold text), secondary button (surface with line border), text link (brand).
Segmented toggle (Day / Week / Month).
Amount input: large 34 px centred number, ₹ prefix, numeric keypad.
Category chip row: horizontally scrollable, one tap to pick.
Balance pill: "You get ₹450" (positive) or "You owe ₹120" (negative).
Card: surface, radius 14, 16–20 padding, no heavy shadows.
Empty states: one line of what to do next plus a primary button. No illustrations needed in Phase 1.
Navigation
Simple mode bottom tabs: Home · Split · Add (centre +) · Goals · Reports. Transactions opens from Home. Full mode keeps today's tabs and adds Split; if that passes five tabs, move Loans and Investments under a More tab. There is one user type: every account manages only its own money.
The approved login screen is the visual reference: green header band with logo, both taglines, "Welcome back", mobile number + OTP, and email as a second option.
Feature 1: Bill splitting
Students create groups, add shared expenses, see who owes whom, and settle up through a UPI payment link. Each person's share also lands in their own transactions, so splitting and budgeting stay connected.
Screens
Split tab (group list). Top card: overall "You get ₹X" and "You owe ₹Y". Below, one row per group with name, member avatars and your net balance pill. Primary button: "New group".
New group. Name, type (Flat, Trip, Hostel floor, Other), add members from contacts or by invite link. Creator is admin.
Group detail. Header with group name and your balance. Tabs: Expenses (newest first, each row: title, paid by, total, your share) and Balances (each member's net). Buttons: "Add expense" and "Settle up".
Add shared expense. Amount (large input), title, category chip, date (today default), paid by (default you; one payer in Phase 1), split method: Equally, Exact amounts, Percentages. Show live check: "₹0 left to assign" must reach zero before Save is enabled.
Settle up. Shows the simplified "X pays Y ₹Z" list. Tap a row you owe → "Pay via UPI" opens a upi://pay deep link with the payee's UPI ID, amount and note. After returning, ask "Did the payment go through?" → Yes records a settlement. Payee can also "Mark as received" for cash.
Invite. Share sheet with a link (prapanji.in/j/<code>) and a WhatsApp-first message: "Join our flat on Prapanji so we can split bills without the mess." New users land on sign-up, then straight into the group.
Rules
Equal splits: divide in paise, hand any leftover paise to the payer's share so totals always match exactly.
Balances are computed from expenses and settlements, never stored as editable numbers.
Debt simplification: minimise the number of payments with a greedy match of largest creditor to largest debtor. Show the simplified list; keep raw pairwise data underneath.
Your share of an expense creates a linked Expense transaction in your own ledger. Paying someone back is a transfer, not a new expense, so it doesn't double-count.
Only the person who added an expense, or the group admin, can edit or delete it. Edits notify members.
A member with a non-zero balance can't leave the group.
Members without a UPI ID see "Mark as paid in cash" only. Ask for UPI ID once, in profile, when someone first gets owed money.
Data model (adapt to the repo's ORM)
split_groups(id, name, type, created_by, invite_code, created_at, archived_at)split_members(group_id, user_id, role[admin|member], joined_at, left_at)split_expenses(id, group_id, title, category_id, amount_paise, paid_by,               split_method[equal|exact|percent], spent_on, created_by, created_at, deleted_at)split_shares(expense_id, user_id, share_paise, linked_transaction_id)split_settlements(id, group_id, from_user, to_user, amount_paise,                  method[upi|cash], upi_ref, status[pending|confirmed], created_at)users: add upi_id (nullable)
API (match existing style)
GET/POST /split/groups, GET /split/groups/:id, POST /split/groups/join/:code
POST /split/groups/:id/expenses, PATCH/DELETE /split/expenses/:id
GET /split/groups/:id/balances (simplified + raw)
POST /split/groups/:id/settlements, POST /split/settlements/:id/confirm
Acceptance criteria
☐ Three users split ₹100 equally: shares are 3334/3333/3333 paise and sum to 10000.
☐ Exact and percent splits refuse to save unless they sum to the total.
☐ Group balances always sum to zero across members.
☐ Simplified settle-up list for a 4-person group never has more than 3 payments.
☐ Adding a shared expense creates exactly one linked transaction per member with a share.
☐ UPI deep link opens with correct payee, amount and note on Android; on failure the user can still mark paid manually.
☐ Invite link works for a brand-new user end to end.
☐ Unit tests for split maths and simplification; integration tests for the expense and settlement endpoints.
Feature 2: OTP login, quick-add and day/week views
Students log in with their mobile number, add a spend in under five seconds, and see their money by day and week instead of only by month or quarter.
Mobile OTP login
Login screen as in the prototype, minus the Student/Parent toggle: +91 mobile field, "Send OTP", then "Continue with email" for the existing flow.
OTP screen: 6 boxes, auto-read on Android where supported, resend after 30 seconds, "Change number" link.
Codes expire in 5 minutes, max 5 wrong tries then a 15-minute lock, max 5 sends per number per hour. Store only a hash of the code.
New number → short sign-up: name only, no role choice. Email becomes optional and can be added in Settings.
Existing email users can add a mobile number in Settings and then use either.
SMS goes through a provider interface with a fake provider that logs codes in dev and tests.
Quick-add (centre + tab)
Opens straight to a big amount field with the number pad up.
Below it, one row of student category chips: Canteen, Food delivery, Travel, Recharge, Stationery & books, Rent/PG, Fun, Other. Most-used first after a week.
Optional note and account (default: last used, often Wallet/UPI).
"Split this" switch: when on, pick a group and it becomes a shared expense (Feature 1).
Save returns to Home with a small toast: "₹60 on Canteen. ₹840 left this week."
Day and week views
Add a Day / Week / Month toggle to Home and Transactions. Default for students: Week. Weeks run Monday to Sunday.
Week view: total spent, spent vs weekly limit bar, a 7-bar daily chart, top 3 categories.
Budgets gain a period: weekly or monthly. A weekly limit can be suggested as monthly pocket money ÷ 4.3.
Quarterly and yearly stay available in full mode and for parents.
Acceptance criteria
☐ New user goes from app open to dashboard via OTP in under 60 seconds on the fake provider.
☐ Rate limits and lockout work and are covered by tests.
☐ A spend can be saved in three taps after typing the amount.
☐ Week totals match the sum of that week's transactions, including split shares.
Feature 3: Teaching layer
Prapanji teaches by showing, not lecturing: a short weekly look back, small habit nudges, and streaks on savings goals. All copy is plain, friendly and never shaming.
Weekly look back (free for students)
Every Monday morning, a card on Home and an optional notification: "Last week: ₹1,240 spent, ₹310 under your limit. Biggest: Food delivery ₹520."
Tapping opens a one-screen summary: total vs limit, top 3 categories, change vs the week before, split balances still open, and one tip.
This replaces Pro-only reports for students; full Reports stay Pro.
Nudges
Rule-based, at most one per day, each can be turned off in Settings.
Examples: 80% of weekly limit with 3 days left; a split balance unsettled for 7+ days; income or pocket money arrived with no goal contribution yet; no spends logged for 3 days.
Tips come from a small editable library (JSON or table) of 30–50 short lessons, e.g. needs vs wants, the 50/30/20 idea, why emergency savings matter, how EMIs and interest work. Tag each tip so the right one shows with the right nudge.
Goal streaks
A streak counts consecutive weeks with at least one contribution to any goal. Show it on the Goals tab with the accent colour.
Milestones at 4, 12 and 26 weeks show a short congratulations message. No points, coins or leaderboards in Phase 1.
Missing a week resets the streak quietly, with "Start again this week" rather than a warning.
Acceptance criteria
☐ Weekly summary numbers match the week view exactly.
☐ No more than one nudge per user per day; all nudge types respect their Settings switch.
☐ Streak logic covered by unit tests, including week boundaries and time zones (IST).
Simple mode, privacy and phasing
Build in three phases, each shippable on its own. Splitting comes first because it is the growth hook.
Simple mode
A per-user mode setting: simple (default) or full, switchable any time in Settings. No user roles; every account manages only its own money.
Simple mode hides Loans, Investments and Input expenses from navigation but keeps their data and routes intact.
First-run setup, three screens max: monthly income or pocket money (optional), weekly limit (pre-filled), first savings goal (optional, skippable).
Privacy and under-18 users
Ask date of birth at sign-up. India's DPDP Act needs verifiable parental consent for under-18 users, and there is no parent account now. So Phase 1 allows 18+ only and shows younger users a short, friendly message. Confirm this with a lawyer before launch; leave the policy text as a placeholder.
Never use a user's data for ads or lending without separate, explicit opt-in consent recorded in the audit log.
Anonymised campus insights, if ever built, must aggregate at least 50 users per group and contain no names, phone numbers or UPI IDs.
Extend "Download my data" and "Delete my account" to cover split data: keep the other members' records and replace the deleted user with "Former member".
Phasing
Phase
Scope
Done when
1
Design tokens, simple mode, OTP login, quick-add, day/week views, weekly budgets
A user can sign up by OTP and log a week of spends
2
Bill splitting with groups, invites, UPI settle-up
A real group of 4 uses it for a week without errors
3
Weekly look back, nudges, goal streaks
A test user gets four weekly look backs and one streak milestone
Definition of done for every phase
☐ Matches the design system tokens and components above.
☐ Works on a 360 px wide Android phone and in dark mode.
☐ All money stored and calculated in integer paise.
☐ Acceptance criteria for the phase pass, with tests added.
☐ Existing features (Transactions, Budgets, Goals, Loans, Reports, Admin) still pass their tests.
☐ PLAN.md updated with what changed and any open questions.
