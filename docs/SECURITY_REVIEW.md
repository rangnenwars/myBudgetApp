# Security & Confidentiality Review — 2026-10-06

A review of Prapanji's server code, database structure and handling of users' confidential data, with what was fixed the same day and what is still open. Re-review when a feature starts sending user data somewhere new (email, a third-party API, a staff screen).

**Scope:** all 72 API routes (`server/src/routes`), auth/session code (`middleware/auth.ts`, `lib/session.ts`, `lib/tokens.ts`), the schema and migrations (`server/src/db/schema.ts`, `server/drizzle/`), logging, the nightly issue digest (`server/src/jobs/`), client token storage (`utils/tokenStorage*.ts`), nginx headers, and the repository itself.

---

## 1. What is already solid

| Area | Finding |
|---|---|
| Cross-user access | Every update/delete by `:id` is preceded by a lookup filtered on `user_id = req.userId`; every list starts from a `user_id` filter. No route trusts a client-supplied user id. |
| Sessions | 15-min JWT access token + 30-day rotated refresh token (hashed at rest, single use — revoke-and-return in one statement). `requireAuth` re-reads the user on every request, so deactivation, deletion, password change and "sign out everywhere" (`tokens_valid_after`) take effect on the next request. |
| Token storage | Native: OS keychain via `expo-secure-store`. Web: refresh token only in an httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`, gated by a custom header; access token only in memory. Nothing in `localStorage`. |
| Passwords | bcrypt cost 12, 8–72 characters (bcrypt's 72-byte limit), re-asked before account deletion; password change/reset signs out other devices. |
| Emailed links | Single-use, hashed, expiring (reset 1 h, verify 7 days); forgot-password always answers 204. |
| Staff surface | Admin user list and system metrics never select financial rows; support can only (de)activate regular users; self-modification is blocked, which makes "last admin locked out" unreachable. |
| Startup checks | Production refuses to start with short/equal/placeholder JWT secrets or without `CORS_ORIGIN`. |
| Headers | helmet on the API; nginx sends a strict CSP (`default-src 'self'`, no inline scripts), `frame-ancestors 'none'`, `nosniff`, `no-referrer`. |
| Injection | Drizzle parameterises every query; LIKE searches escape `% _ \`; CSV export neutralises formula cells (`= + - @`). |
| Logs | The 500 handler logs only the driver code/message, stripping Drizzle's SQL parameters (amounts, notes, emails). |
| Uploads | Screenshots ≤ 2 MB after decoding; real image type sniffed from the bytes (PNG/JPEG/WebP only); served with `nosniff`. |

---

## 2. Findings and status

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | **Issue reports exposed users' financial data.** Support and admin could open any report's screenshot (a screenshot of this app shows the user's balances); the nightly digest emailed screenshots and reporter emails; with `ANTHROPIC_API_KEY` set, screenshots went to Anthropic; screenshots were kept forever; "Download my data" left reports out. | ✅ **Fixed.** Screenshot endpoint: reporter or **admin** only. Digest defaults: reporter shown as `user #id`, no screenshots attached — each behind an explicit opt-in env var. The Anthropic/Claude integration was then **removed entirely** (owner decision, 2026-10-06): fix suggestions come only from the server's own rules, so reports never go to an outside service. Screenshots deleted 90 days after a report is resolved/closed (nightly, digest on or off). Export includes reports and free-money history. See `server/src/lib/issuePrivacy.ts`, [README.md §3b](README.md). |
| 2 | **High** | A real production dump (`db dump/mybudget_2026-10-04_065348.dump`) sat in the working tree, **not** git-ignored — one `git add .` from being published. | ✅ **Fixed** in `.gitignore` (`/db dump/`, `*.dump`, `*.sql.gz`). Git history checked: no dump was ever committed. The file itself is still on disk — **move it into `backups/` or delete it.** |
| 3 | Medium | The digest printed the whole email (report text, reporter emails) to the container log when SMTP wasn't configured. | ✅ **Fixed** — logs the subject only; `--dry-run` (run by hand) still prints the full email to the operator's terminal. |
| 4 | Medium | Login timing revealed which emails are registered (an unknown email skipped the ~250 ms bcrypt check). | ✅ **Fixed** — unknown emails are compared against a dummy hash of the same cost. Test: `security.test.ts`. |
| 5 | Medium | The privacy policy is a placeholder, and its one promise ("used only to run your own ledger") was contradicted by issue-report text optionally going to an outside AI service (Anthropic, for fix suggestions). The Report issue screen doesn't say who sees a report. | ✅ **Fixed** (wireframe approved 2026-10-06). The Report issue screen now has a notice above the screenshot button (who can open it, 90-day deletion) and says what the AI assistant sees, with a link to the privacy policy; the privacy page has a "Problem reports" section. The rest of the policy is still a draft placeholder to be reviewed before launch. |
| 6 | Medium | Registration answers "an account with that email / mobile number already exists", so anyone can test whether a person's email or phone is registered (rate-limited to 5 per 15 min per IP). | Accepted trade-off for now — the alternative (always "check your email") needs an email-first sign-up flow. Revisit before a public launch. |
| 7 | Low | Two ownership rules were enforced only by the routes: a goal contribution's user matching its goal's user, and a transaction/repeating entry/budget using only system or own categories. | ✅ **Fixed** in migration `0016_owner_integrity` (composite FK + trigger). Test: `dbIntegrity.test.ts` writes straight to the database. Production: run [OPERATIONS_RUNBOOK.md §5.4](OPERATIONS_RUNBOOK.md) once. |
| 8 | Low | The admin audit log keeps a deleted user's email forever (snapshotted so entries stay readable). | Open — **owner decision**: keep (accountability) or anonymise `target_email` on account deletion (erasure). |
| 9 | Low | Forgot-password still awaits the email send only when the account exists, so its response is slightly slower for registered emails. | Open — small; fix by sending in the background once a job queue exists. |
| 10 | Low | A stray file `root@prapanji` (a copy of `server/scripts/privatize-personal-categories.sql`, containing family members' names as category keys) is in the repo root, untracked. | Open — **delete it**; the real script is already in `server/scripts/`. |
| 11 | Process | The server's 80% branch / 90% coverage floor was never enforced: `server/package.json` `quality` (run by CI and the pre-commit hook) calls `npm test`, not `test:coverage`. Branch coverage had slipped to 77.3%. | Coverage raised to **88.0%** (386 tests). Enforcement still **open** — changing `quality` to `npm run typecheck && npm run test:coverage` is a one-line change awaiting approval. |

---

## 3. Test coverage after the review

| Suite | Before | After |
|---|---|---|
| Server tests | 328 | **386** (31 files) |
| Server branch coverage | 77.3% (below the 80% floor) | **88.0%** — now also measuring `src/jobs/` |
| Client tests | 104 | **109** |
| Client files with enforced thresholds | `utils/calculations.ts` | + `utils/dates.ts`, `utils/issues.ts` |

New test files: `issueSuggestions.test.ts` (server-side suggestions, plus a guard that no AI SDK is a server dependency), `mail.test.ts` (SMTP, nodemailer mocked), `middlewareUnits.test.ts`, `dbIntegrity.test.ts`, `issueDigestRender.test.ts`, `issueConstants.test.ts` (client constants vs database CHECKs), and `utils/__tests__/issues.test.ts`.
