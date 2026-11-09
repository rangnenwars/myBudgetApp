# The paid plan: six months free, then ₹200 a year

How access works, how people pay, what an admin can do, and how to switch the plan on safely. Built 2026-11-09. The code is in `server/src/lib/access.ts`, `plan.ts`, `payments.ts`, `accessNotices.ts` and `routes/plan.ts`, `routes/adminPlan.ts`.

## The rule

A new account gets **free full access for 6 months, counted from its own sign-up date**. After that, keeping **Goals, Loans, Investments, Plan ahead and Pro insights and trends** costs **₹200 a year**. Price, free months, notice days and what the plan includes are set by an admin (Admin, then Plan and pricing), not in code.

Always free, whatever the plan: Home, Transactions, Budgets, Accounts, People, Input expenses, and the Monthly and Categories reports.

When access ends, **nothing the user saved is touched**. The paid screens are paused and everything comes back on renewing. Loan EMIs already set to post keep adding to expenses.

## Who has access (decided by the server, in this order)

1. **Company account**: always yes, never charged. For staff, testers and operations. Set by an admin on the user sheet, audit-logged. Admin, support and system-manager accounts and the `@mybudget.local` demo accounts were marked Company by the migration. This is *who the account is*; `role` is *what it may do*.
2. **An exception**: full access on purpose, with a required reason and an **optional last day**. With no last day it never ends by itself, so the Exceptions list flags it. One at a time; a new one replaces the old and the old stays in the history.
3. **A paid period** running.
4. **The free trial** running.
5. **A payment waiting to be confirmed**: access carries on for 3 days, **once per access period**, so a lapsed user isn't locked out while an admin checks.
6. Otherwise **locked**.

The app only displays this (`user.plan` in the profile). A locked feature is refused by the server (`FEATURE_NOT_ADDED`), so editing the app can't unlock it. Pro insights are worked out in the app from data the user already has, so that lock is a convenience, not a security wall.

Staff can still switch **one feature off for one user** (user sheet, Feature access); it stays off even while the plan includes it. A feature staff switched **on** by hand, with an end date or not, keeps working without the plan.

The tier the app sees follows the plan once it is enforced: Pro only while the plan is running and staff haven't set the account to Standard.

## How people pay

1. An admin uploads the **UPI QR** and enters the **UPI ID** (Admin, Plan and pricing, Payment details). The server **reads the QR** and refuses it unless it pays that UPI ID. If a QR can't be read, the admin must tick that they checked it by hand, and that is recorded. Saving needs the admin's **password** and **emails every admin**, so a swapped QR can't go unnoticed.
2. Every user sees the QR, UPI ID, a Copy button and an "Open my UPI app (₹200)" button on **Renew**, even after access ends.
3. The user pays, adds a **screenshot** (up to 2 MB) and the **transaction ID**, and taps "I have paid". They see "We're checking your payment" and everything keeps working.
4. An admin checks the money arrived in the bank or UPI app, then **Confirm received** (Admin, Payments to confirm). That adds a year starting when the current period ends, so renewing early loses no time, saves the ID and who confirmed it, and emails a receipt. Or **Reject** with a reason, or ask the user to **send it again**.
5. An admin can also **record a payment by hand** for any user (user sheet).

Safety built in: one transaction ID backs one payment, and one screenshot backs one payment; 3 submissions a day per user; one payment waiting at a time; two admins confirming at once adds only one period; the amount can't be below the plan price; each payment keeps the price it was paid at. Payment screenshots are admin-only (not support) and are **deleted 30 days after a decision**; the ID, amount and who confirmed stay.

This first version is manual. Automatic matching against a bank or gateway record can be added later; the claims already store what it needs.

## Switching it on safely

The plan ships **switched off (shadow mode)**: nobody is locked and access works as before, while every account is given its free period. Then, in Admin, Plan and pricing:

1. **Check the dry run**: who would lose the paid features if it were on now.
2. **Send the notice** to existing users. It emails each customer when their free access ends and moves any end date sooner than the notice period out to it (default 30 days), so nobody is locked the day it starts. Safe to run again; nobody is emailed twice for the same date.
3. **Turn it on.** This is refused until the notice has been sent, and asks for the admin's password. It can be turned **off** again at any time (the rollback), and everyone gets their access back at once.

Once on, a nightly job sends reminder emails (30 days, 7 days, 1 day, and when access ended), **each once**, only the most urgent stage reached. Company accounts, accounts with an exception, and switched-off accounts get none.

The old sign-up defaults ("everyone gets Goals") and grandfathered rows stop granting access once the plan is on, so they can't bypass it.

## For an admin, day to day

| To do | Where |
|---|---|
| Change price, free months, notice days, what is included | Admin, Plan and pricing |
| See who is ending soon, ended, waiting | Admin, Plan and pricing, Ending soon |
| Set or change the QR and UPI ID | Admin, Plan and pricing, Payment details |
| Confirm or reject a payment | Admin, Payments to confirm |
| Give one user an exception (with a date) | User sheet, Plan and access |
| See all exceptions, find ones with no end date | Admin, Exceptions |
| Mark an account Company | User sheet, Account type |
| Switch one feature off or on for one user | User sheet, Feature access |

Every change above is in the audit log with who did it and why.

## Things to know

- **Reminder emails and the welcome email** use the existing mailer (Resend or SMTP). Without email configured they are logged, not sent.
- **`PAYMENT_UPI_ID`** (an environment variable used before this) is no longer used; the UPI ID is set in the app.
- **App stores:** if you later publish on the Play Store or App Store, those stores may require their own billing for in-app subscriptions. The web app is not affected.
- **Invoices:** receipts are a simple email. A GST invoice is not produced.
