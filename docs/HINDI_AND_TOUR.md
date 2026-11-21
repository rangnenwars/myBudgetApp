# Hindi language and the first-time tour

Two features that shipped together: the app can be used in **Hindi** on every page, and new sign-ups get a short **tour** with a Skip button.

## For people using the app

- **Language:** Settings, then **Language**, switches between English and हिन्दी. The whole app changes at once, on the page you are on, and the choice is remembered on that device. English is the default. A new sign-up can also choose on the first tour card.
- **The tour:** opens by itself right after sign-up, and again at each sign-in on any device until it has been finished or skipped once, for the first 7 days of the account (the server decides: `GET /tour/status`). If the server cannot be reached, the flag saved on the device at sign-up is used. It is a guided walk on the real Home screen: the screen is dimmed, one item is outlined with an arrow and a short message, and **Next** moves to the next. After a Welcome card (with the language choice) it goes through Home top to bottom (your month, Settings, the + button, This month, Money left after fixed bills, People and Accounts, Income/expense/savings, Where the money goes, Recent transactions, Insights, More features), then points at each page in the tab bar (Transactions, Loans, Investments, Goals, Reports) with a line on what it does, and ends with a last card. Items you do not have (a feature switched off, no recent entries yet) are left out, so it is 11 to 18 steps. Home scrolls by itself to bring an item into view, and if an item cannot be shown on a very small window that step becomes a centred card. **Skip tour** is on every step but the last. The last card offers **Add my first spend**. Accounts older than 7 days, and company (staff) accounts, never get it by itself. **Settings, then How to use Prapanji, then Replay the tour** opens it any time.

## How the Hindi works

The English text itself is the key; there are no key names to look up. A missing translation falls back to the English text, so a screen is never blank.

| Piece | File |
|---|---|
| Translate, fill `{name}` placeholders, date locale | `utils/i18n.ts` |
| Hindi for the screens (generated, one line per text) | `utils/i18nHiScreens.ts` |
| Hindi added later, and small words used as values (`days`, `at sign-up`) | `utils/i18nHiExtra.ts` |
| Hindi for messages the server sends back, and patterns for ones with a value | `utils/i18nServer.ts` |
| Both merged | `utils/i18nHi.ts` |
| The language state; a language change draws the screens again | `context/LanguageContext.tsx`, `components/i18n/RemountOnLanguage.tsx` |
| `Text` and `TextInput` that translate what they are given | `components/i18n/index.tsx` |
| The saved choice | `utils/languagePrefs.ts` |

Every screen imports `Text` and `TextInput` from `components/i18n` instead of from `react-native`, so everything written in a `<Text>` is translated with no extra code. Text built from values is written as `t('Next: {0}', { 0: date })` so it can be translated as a whole sentence and the Hindi can put the value where the sentence needs it. Dates use `dateLocale()`, so month names come out in Devanagari. Amounts keep Indian grouping and Latin digits. Names and anything a person typed are never translated.

Messages from the server (such as "Loan not found.") are translated on the phone, by their English text, so the server did not need to change. Messages with a value, such as `A part payment can't exceed the outstanding balance (100000).`, are matched by patterns in `utils/i18nServer.ts`.

Finance words people already say in English (EMI, SIP, UPI, Pro, QR, CSV) are kept in English inside the Hindi.

### Adding or changing text

1. Write the English in the screen as usual (`<Text>Save</Text>`, or `t('...')` if it has values).
2. Add the English and its Hindi to `utils/i18nHiExtra.ts` (screens) or `utils/i18nServer.ts` (server messages).
3. Run `npm run i18n:missing`. It lists any text that still has no Hindi. The same check runs in `npm test` and fails when something is missing, so untranslated text cannot be merged.

Text that is code and not words goes in `scripts/i18nIgnore.json`.

### Please have the Hindi reviewed

The Hindi was written by Claude and has not been read by a native speaker. Money words in particular have more than one reasonable choice, and some people prefer more English words ("budget", "report") than the current text uses. Send corrections as a list of English text and the Hindi you want, or edit the files above directly.

## Counting the tour

`POST /tour/outcome` records, once per person, whether the tour **finished** or was **skipped**, on which card, and the language. The first outcome wins, and replaying records nothing. **System metrics** shows the counts (finished, skipped, skipped by card, chose Hindi) for customer accounts only; staff are left out. Counts only: nothing about what anyone did in the app. Table `tour_outcomes` (migration 0028).

## What is not done

- The language is remembered per device, not per account, so signing in on a new phone starts in English.
- Hindi is for the app screens and server messages. Emails the server sends (reminders, receipts) are still English.
- The login slides' artwork has a few words drawn inside the images (SVG text) that are not translated.
