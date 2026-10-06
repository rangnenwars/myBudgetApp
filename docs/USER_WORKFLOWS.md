# User Usage Workflows — One Flow per Screen

Every screen of My Budget as a picture. Read left to right (or top to bottom). Dotted line = optional link, diamond = a choice.

**Legend**

```mermaid
flowchart LR
  a(["Start"]):::entry ~~~ b["Screen / action"] ~~~ c{"Decision"} ~~~ d["Done"]:::ok ~~~ e["Problem"]:::bad ~~~ f["Heads-up"]:::warn ~~~ g["Pro / staff"]:::pro
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

**Screens:** [App map](#map) · [Login](#login) · [Register](#register) · [Forgot password](#forgot) · [Reset password](#reset) · [Confirm email](#verify) · [Dashboard](#dashboard) · [Quick add](#quickadd) · [Input expenses](#input) · [Transactions](#transactions) · [Loans](#loans) · [People](#people) · [Person](#person) · [Investments](#investments) · [Goals](#goals) · [Accounts](#accounts) · [Budgets](#budgets) · [Free-money day](#freemoney) · [Reports](#reports) · [Settings](#settings) · [Report issue](#issue) · [Admin: Users](#users) · [Admin: Audit log](#audit) · [Admin: System metrics](#metrics)

Words are kept to a minimum on purpose. Full explanations are in [USER_MANUAL.md](USER_MANUAL.md); the screen files are listed in [README.md](README.md) §5.

---

## Map

<a id="map"></a>

### App map

`all screens` · Everyone

```mermaid
flowchart LR
  S(["Open app"]):::entry --> T{"Signed in?"}
  T -->|no| LG["Login"]
  T -->|yes| DB["Dashboard"]
  LG --> DB
  LG -.->|new| RG["Register"] --> DB
  LG -.->|forgot| FP["Forgot password"] -.->|email link| RS["Reset password"] -.-> LG
  RG -.->|email link| VE["Confirm email"] -.-> DB
  subgraph TABS["Bottom tabs"]
    DB
    TX["Transactions"]
    LN["Loans"]
    IV["Investments"]
    GL["Goals"]
    RP["Reports"]:::pro
  end
  DB --- TX --- LN --- IV --- GL --- RP
  DB --> QA["Quick add"]
  DB --> PP["People"]
  PP --> PE["One person"]
  DB --> FM["Free-money day"]
  DB --> IE["Input expenses"]
  DB --> BG["Budgets"]
  DB --> AC["Accounts"]
  DB --> ST["Settings"]
  DB --> RI["Report issue"]
  DB --> AD["Users / Metrics"]:::pro --> AL["Audit log"]:::pro
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

## Sign in and email links

<a id="login"></a>

### Login

`/login` · Everyone · `app/login.tsx`

```mermaid
flowchart LR
  A(["Open"]):::entry --> B["Email + password"] --> C["Sign in"] --> D{"Password right?"}
  D -->|no| X["Invalid email or password"]:::bad --> B
  D -->|yes| E{"Account active?"}
  E -->|no| Y["Account deactivated"]:::bad
  E -->|yes| OK["Dashboard"]:::ok
  B -.-> F["Forgot password"]
  B -.-> G["Create account"]
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="register"></a>

### Register

`/register` · Everyone · `app/register.tsx`

```mermaid
flowchart LR
  A(["Open"]):::entry --> B["Name"] --> C["Email"] --> D["Password 8+"] --> E["Create account"] --> F{"Valid?"}
  F -->|"short password / email in use"| X["Error shown"]:::bad --> B
  F -->|yes| OK["Dashboard"]:::ok
  OK --> M["Confirmation email sent"]:::warn
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="forgot"></a>

### Forgot password

`/forgot-password` · Everyone · `app/forgot-password.tsx`

```mermaid
flowchart LR
  A(["Login: Forgot password"]):::entry --> B["Enter email"] --> C["Send link"] --> D["Check inbox"]:::warn --> E["Open link"] --> F["Reset password screen"]:::ok
  D -.->|"nothing arrives"| G["Ask an admin to reset"]:::pro
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="reset"></a>

### Reset password

`/reset-password?token=` · Email link · `app/reset-password.tsx`

```mermaid
flowchart LR
  A(["Open email link"]):::entry --> B["New password 8+"] --> C["Save"] --> D{"Link valid?"}
  D -->|yes| OK["Every device signed out"]:::warn --> L["Login with new password"]:::ok
  D -->|"expired or used"| X["Link not valid"]:::bad --> R["Request a new link"]
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="verify"></a>

### Confirm email

`/verify-email?token=` · Email link · `app/verify-email.tsx`

```mermaid
flowchart LR
  A(["Open email link"]):::entry --> B{"Link valid?"}
  B -->|yes| OK["Email confirmed"]:::ok --> D["Dashboard banner gone"]
  B -->|no| X["Link not valid"]:::bad --> S["Settings: Send confirmation email"] --> A
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

## Everyday screens

<a id="dashboard"></a>

### Dashboard

`/(tabs)` · Signed in · `app/(tabs)/index.tsx`

```mermaid
flowchart LR
  D(["Dashboard"]):::entry
  D --> M["Month arrows"] --> T["Income - Expense = Net savings"]
  D --> FMC["Free-money card"] --> FMD["Free-money day"]
  D -->|"orange plus"| QA["Quick add"]
  D --> PC["You get / You owe card"] --> PL["People"]
  D --> TOP["Top 5 expense categories"]
  D --> BA{"Any budget at 80%+?"} -->|yes| BAL["Budget alerts card"]:::warn --> BUD["Budgets"]
  D --> PI["Pro insights"]:::pro
  D --> IE["Input expenses"]
  D --> BUD
  D --> ACC["Accounts"]
  D --> VB{"Email unconfirmed?"} -->|yes| BAN["Yellow banner"]:::warn --> SET["Settings"]
  D -->|"bug icon"| RI["Report issue"]
  D -->|"gear icon"| SET
  D -->|"shield icon"| SH["Staff screens"]:::pro
  D -->|"log-out icon"| LO["Login"]
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="quickadd"></a>

### Quick add

`sheet on /(tabs)` · Signed in · `components/QuickAddSheet.tsx`

```mermaid
flowchart LR
  A(["Orange plus"]):::entry --> B{"Expense or Income"}
  B --> C["Amount on keypad"] --> D{"Category"}
  D -->|"most-used chip"| E["Save"]
  D -->|More| F["Pick from full list"] --> E
  E --> G["Saved for today"]:::ok --> H["Dashboard totals refresh"]
  C -.-> N["Add note"]
  C -.->|"Split across categories"| S["Add form with Split on"]
  E -.-> X["Enter an amount / pick a category"]:::bad
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="input"></a>

### Input expenses

`/input-expenses` · Signed in · `app/input-expenses.tsx`

```mermaid
flowchart LR
  A(["Dashboard"]):::entry --> B["Input expenses"] --> C{"Period"}
  C -->|Monthly| D["Rows: category + amount"]
  C -->|Quarterly| D
  C -->|Yearly| D
  D <-->|"add / remove row"| D2["More rows"]
  D --> F["Save"] --> G{"Quarterly or yearly?"}
  G -->|yes| H["Divided to monthly"]
  G -->|no| I["Amount as entered"]
  H --> J["One transaction per row"]
  I --> J --> K["Dashboard updated"]:::ok
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

## Money tracking

<a id="transactions"></a>

### Transactions

`/(tabs)/transactions` · Signed in · `app/(tabs)/transactions.tsx`

```mermaid
flowchart TB
  subgraph ADD["Add"]
    direction LR
    a1["Plus"] --> a2{"Income or Expense"} --> a3["Category: search or add custom"] --> a4["Amount"] --> a5["Date: today by default"] --> a6{"How often"}
    a2 -.-> s1["Split switch"] --> s2["Lines: category + amount"] --> s3{"Left to assign = 0?"}
    s3 -->|yes| s4["One entry per category"]:::ok
    s3 -->|no| s5["Fix the amounts"]:::bad
    s1 -.->|"With people"| w1["Pick friends: Equal or Custom"] --> w2["Your share = your spending"]:::ok
    w1 --> w3["Each friend owes you, in People"]:::ok
    a6 -->|Once| a8["Exact amount"]
    a6 -->|"Monthly / Quarterly / Yearly"| a7["Monthly equivalent"]
    a8 --> a9{"Repeat switch"}
    a7 --> a9
    a9 -->|on| a10["Added again every period"]:::ok --> a11["Save"]
    a9 -->|off| a11
  end
  subgraph CHANGE["Change"]
    direction LR
    b1["Tap a row"] --> b2["Edit + Save"]:::ok
    b3["Trash"] --> b4{"Confirm?"} -->|yes| b5["Deleted"]:::bad
    b6["Repeating button"] --> b7["Change amount / day, or stop"]
  end
  subgraph FIND["Find"]
    direction LR
    c1["Search note, category, amount"] --> c3["List: 50 at a time"]
    c2["All / Expenses / Income"] --> c3
  end
  ADD ~~~ CHANGE ~~~ FIND
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="loans"></a>

### Loans

`/(tabs)/loans` · Signed in; planner is Pro · `app/(tabs)/loans.tsx`

```mermaid
flowchart TB
  subgraph ADD["Add"]
    direction LR
    a1["Plus"] --> a2["Name, principal, outstanding, EMI"] --> a3["Optional: rate, tenure, lender, note"] --> a4{"Add EMI to expenses?"}
    a4 -->|"on (default)"| a5["EMI posted monthly + balance paid down"]:::ok
    a4 -->|off| a6["Mark EMI paid by hand"]
  end
  subgraph PART["Part payment"]
    direction LR
    b1["Part payment"] --> b2["Amount"] --> b3["Before / after preview"] --> b4["Confirm"] --> b5["Balance down, EMI scaled, tenure same"]:::ok
  end
  subgraph PLAN["Debt payoff planner"]
    direction LR
    c1["Planner"]:::pro --> c2{"Strategy"}
    c2 -->|Snowball| c3["Month-by-month plan"]
    c2 -->|Avalanche| c3
    c4["What if + X per month"] --> c3
  end
  ADD ~~~ PART ~~~ PLAN
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="people"></a>

### People

`/people` · Signed in · `app/people/index.tsx`

```mermaid
flowchart LR
  A(["Home card or People link"]):::entry --> B["You get / You owe totals"]
  B --> C{"Filter"}
  C -->|All| D["Everyone"]
  C -->|"You get"| E["They owe you"]:::ok
  C -->|"You owe"| F["You owe them"]:::bad
  C -->|Overdue| G["Past pay-back date"]:::warn
  D --> H["Tap a name"] --> I["One person"]
  B --> J["Add person or IOU"] --> K{"I lent or I borrowed"}
  K --> L["Person + amount + optional due date"] --> M["Save"]:::ok --> I
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="person"></a>

### Person

`/people/[id]` · Signed in · `app/people/[id].tsx`

```mermaid
flowchart LR
  A(["Tap a name"]):::entry --> B{"Balance"}
  B -->|"they owe you"| C["They paid: amount"]
  B -->|"you owe them"| D["I paid: amount"]
  B -->|zero| S["All settled"]:::ok
  C --> E{"More than owed?"}
  D --> E
  E -->|yes| X["Refused with the figure"]:::bad
  E -->|no| F["Balance goes down"]:::ok
  A --> G["Lend or borrow more"] --> H["Balance changes"]
  A --> I["Due date"] -.-> J["Overdue flag when past"]:::warn
  A --> K["Write off"] --> L["Cleared, kept in history"]:::warn
  A --> M["Trash on a line"] --> N["Balance recalculated"]
  A --> O["Delete person"]:::bad
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="investments"></a>

### Investments

`/(tabs)/investments` · Signed in · `app/(tabs)/investments.tsx`

```mermaid
flowchart LR
  A["Plus"] --> B["Name, type, amount"] --> C["Current value, dates, note"] --> D["Save"] --> E["Gain % calculated"]:::ok --> F["Portfolio summary"]
  G["Tap a card"] --> H["Update current value"] --> D
  I["Trash"] --> J{"Confirm?"} -->|yes| K["Deleted"]:::bad
  F -.-> NW["Net worth"]:::pro
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="goals"></a>

### Goals

`/(tabs)/goals` · Signed in; ETA is Pro · `app/(tabs)/goals.tsx`

```mermaid
flowchart LR
  A["Plus"] --> B["Name + target"] --> C["Deadline, colour, icon"] --> D["Save"] --> E["Progress bar"]
  E --> F{"Contribute"}
  F -->|Add| G["Saved amount up"] --> E
  F -->|Remove| G2["Saved amount down"] --> E
  G --> H["History entry"]
  E --> I["Goal ETA"]:::pro
  J["Tap a card"] --> K["Edit name / target"]
  L["Trash"] --> M{"Confirm?"} -->|yes| N["Deleted"]:::bad
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="accounts"></a>

### Accounts

`/accounts` · Signed in · `app/accounts.tsx`

```mermaid
flowchart LR
  A(["Dashboard: Accounts"]):::entry --> B["Plus"] --> C{"Type"}
  C -->|Bank| D["Name + balance"]
  C -->|Cash| D
  C -->|"Wallet / UPI"| D
  C -->|"Credit card"| D2["Name + amount owed"]
  D --> E["Save"] --> F["Adds to net worth"]:::ok
  D2 --> E2["Save"] --> F2["Subtracts from net worth"]:::warn
  G["Tap an account"] --> H["Edit balance"] --> E
  I["Trash"] --> J{"Confirm?"} -->|yes| K["Deleted"]:::bad
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

## Insight and limits

<a id="budgets"></a>

### Budgets

`/budgets` · Signed in · `app/budgets.tsx`

```mermaid
flowchart LR
  A(["Dashboard: Budgets"]):::entry --> B["Pick expense category"] --> C["Monthly limit"] --> D["Save"] --> E["This month's progress bar"] --> F{"Used"}
  F -->|"under 80%"| G["Normal"]:::ok
  F -->|"80% to 100%"| H["Yellow"]:::warn
  F -->|"over 100%"| I["Red"]:::bad
  H --> J["Alert on Dashboard"]
  I --> J
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="freemoney"></a>

### Free-money day

`/free-money-day` · Signed in · `app/free-money-day.tsx`

```mermaid
flowchart LR
  A(["Dashboard card"]):::entry --> B{"Income known?"}
  B -->|no| X["Add repeating income"]:::warn
  B -->|yes| C{"Committed vs income"}
  C -->|"under 100%"| D["Free-money day: date + days left"]:::ok
  C -->|"100% or more"| E["No free days"]:::bad
  D --> W["Change vs last week"]
  A --> L["What you owe each month"]
  L --> M["Loan EMIs"]
  L --> R["Repeating bills"]
  A --> P["Prepay a loan: amount"] --> Q["New EMI + new free-money day"]:::ok --> G["Preview only"]:::warn
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="reports"></a>

### Reports

`/(tabs)/reports` · Pro · `app/(tabs)/reports.tsx`

```mermaid
flowchart LR
  A(["Reports tab"]):::entry --> B{"Pro tier?"}
  B -->|no| C["Pro gate"]:::bad --> D["Ask an admin for Pro"]:::warn
  B -->|yes| E["Range: Month / 3M / 6M / Year / All"]:::pro
  E --> F["Income / Expense / Net trend"]
  E --> G["Category donut"]
  E --> H["Debt payoff progress"]
  E --> I["Goal progress"]
  E --> J["Net worth over months"]
  E --> K["Export CSV"] --> L["Share or download"]:::ok
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

## Your account

<a id="settings"></a>

### Settings

`/settings` · Signed in · `app/settings.tsx`

```mermaid
flowchart LR
  S(["Settings"]):::entry
  S --> A["Send confirmation email"] --> A2["Link in inbox"]
  S --> B["Change password"] --> B1["Current + new 8+"] --> B2["Other devices signed out"]:::warn
  S --> C["Download my data"] --> C1["One file saved"]:::ok
  S --> D["Sign out everywhere"] --> D1{"Confirm?"} -->|yes| D2["Every device signed out"]:::warn --> LO["Login"]
  S --> E["Delete my account"] --> E1["Enter password"] --> E2{"Confirm?"} -->|yes| E3["Account + data gone"]:::bad --> LO
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="issue"></a>

### Report issue

`/report-issue` · Signed in · `app/report-issue.tsx`

```mermaid
flowchart LR
  A(["Bug icon"]):::entry --> B["Category"] --> C["Screen"] --> D["Severity"] --> E["Title + description"] --> F["Steps, expected (optional)"] --> G{"Screenshot?"}
  G -->|"yes, max 2 MB"| H["Attach"] --> I["Send"]
  G -->|no| I
  I --> J["Listed below: new"] --> K["triaged"] --> L["resolved"]:::ok
  K --> M["won't fix"]
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

## Staff only

<a id="users"></a>

### Admin: Users

`/admin` · Admin, Support · `app/admin/index.tsx`

```mermaid
flowchart LR
  A(["Shield icon"]):::pro --> B{"Role"}
  B -->|"Admin / Support"| C["Users list"]
  B -->|"System manager"| M["System metrics"]:::pro
  C --> S["Search name or email"] --> C
  C --> T["Tap a user"] --> U{"Which user?"}
  U -->|"yourself"| V["Blocked: use your own Settings"]:::bad
  U -->|"someone else"| W["Details sheet"]
  W --> X["Active switch: admin + support"]
  W --> Y["Role: admin only"]:::pro
  W --> Z["Tier: admin only"]:::pro
  W --> D["Delete: admin only"]:::bad --> D1{"Confirm?"} -->|yes| D2["Account + data deleted"]:::bad
  X --> L["Audit log entry"]:::ok
  Y --> L
  Z --> L
  D2 --> L
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="audit"></a>

### Admin: Audit log

`/admin/audit-log` · Admin · `app/admin/audit-log.tsx`

```mermaid
flowchart LR
  E["Role / tier / active / delete change"] --> L["Audit log"]:::ok
  A(["Users: document icon"]):::pro --> V["Latest 100 entries"]
  L --> V --> R["Who  |  What  |  Whom  |  Details"]
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```

<a id="metrics"></a>

### Admin: System metrics

`/admin/metrics` · Admin, System manager · `app/admin/metrics.tsx`

```mermaid
flowchart LR
  A(["Shield: system manager"]):::pro --> M["System metrics"]
  B["Users screen: admin"] --> M
  M --> U["Users: active / inactive"]
  M --> S["Signups + logins"]
  M --> N["Usage counts"]
  M --> C["Cost / revenue estimate"]
  M --> X["Read only: no names, no actions"]:::warn
  classDef entry fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef ok fill:#d1fae5,stroke:#059669,color:#064e3b
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pro fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f
```
