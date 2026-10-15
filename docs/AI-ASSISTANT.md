# AI financial assistant

A chat panel in the dashboard (the **Ask** button) that answers questions about
Avernek's books and prepares expenses and client payments for you to confirm,
by text or voice. It runs inside the existing app: no new service, port,
database or container.

## How it works

```
Browser (panel)                     Next.js server (this app)                         OpenRouter
───────────────                     ─────────────────────────                         ──────────
message ─────► POST /api/assistant/chat
               session + admin flag checked ─► gpt-4.1-mini picks a tool ─────────────► (tools, ZDR)
               arguments validated (zod) ◄──────────────────────────────────────────────┘
               permission checked per tool
               tool runs: predefined, parameterised queries + the app's own calculations
◄── cards ──── plain question: the tool's own summary, no second model call
               "why/how" question: tool data only → short explanation (second call)
               change to the books: a form for missing details, then a draft to confirm
confirm ─────► POST /api/assistant/confirm
               draft claimed once (pending → executing), permission re-checked,
               saved through the SAME server action as the regular form, audited
voice ───────► POST /api/assistant/transcribe ──► speech model ───────────────────────► (ZDR)
◄── text ───── put in the message box to check and edit; never sent by itself
```

Principles, enforced in code rather than in the prompt:

- **No model-written SQL.** The model chooses among 18 predefined tools
  (`src/lib/ai/tools/`) and fills in their arguments. Every argument is
  validated on the server; names are resolved against the database.
- **Same numbers as the pages.** Tools call the functions the pages use:
  `lib/expense-summary` (dashboard totals, now exact to the paisa),
  `summarizeIncomeAgreement` (Clients/Income), `loadLedger` and
  `computeTaxPosition` (Funds/VAT). The model never computes a figure.
- **Changes need a click.** A write tool never writes. It returns a form for
  what is missing, or a draft with every value shown. Only `/confirm` executes
  it, once, through `addExpense`, `updateExpense`, `recordIncomePayment` or
  `updateIncomePayment`, which re-validate everything as for the normal forms.
- **Permissions on the server.** Members read everything and add expenses (as in
  the UI); editing expenses and recording or correcting client payments need an
  administrator. The admin flag is read from the database on every request.

## Tools

| Reads (any signed-in user) | Answers |
|---|---|
| `get_expense_summary` | Spending for a period, by category/vendor/month/payer/client |
| `compare_expenses` | Two periods side by side, biggest changes |
| `list_expenses` | Recent or largest expenses with filters |
| `get_subscriptions` | Active subscriptions; next month's renewals (dashboard's figure) |
| `list_clients` | Clients by status, collected, due now |
| `get_client_overview` | One client: services, dates with day counts, money position |
| `get_client_payments` | Payment history with VAT, TDS and bank amounts |
| `get_receivables` | Due now (Clients page "Outstanding"), overdue, or unpaid balance |
| `get_upcoming_payments` | What falls due in the next N days |
| `get_income_summary` | Gross income with a VAT & TDS section, by month/client/source |
| `get_recurring_revenue` | Monthly fees from active clients |
| `get_tax_position` | VAT owed / carried forward, TDS credit (Funds/VAT pages) |
| `get_account_balances` | Balance, VAT reserved and free money per account |
| `get_financial_summary` | Income, expenses, the difference, balances, money due |

| Changes (confirm first) | Who |
|---|---|
| `create_expense` | Any signed-in user |
| `update_expense` | Administrators |
| `record_client_payment` | Administrators |
| `update_client_payment` | Administrators |

Not available by design: deleting or reversing anything, client
profitability (expenses link to clients only by a free-text name), creating
clients, transfers, loans.

## Business rules it follows

- **Dates.** Contract age = `agreement_date`; website live = since
  `website_completed_date` ("Website delivered"); service live = since Day 1
  (`goLiveDate`). "Today" is the app's `todayIso()`, the server's date, as on
  every page.
- **Income.** Gross income is the bill amount excluding VAT (client payments +
  other income; capital and loans are not income). VAT and TDS are shown in
  their own section: VAT collected for the IRD, TDS withheld by clients (a
  credit), and what reached the bank.
- **Expenses.** Required: amount > 0, date, category, who paid (a team member,
  or a company account), and for a USD charge from an NPR account the exact
  NPR charged. Date defaults to today, currency to NPR, the payer to you, and
  the category to the vendor's category, as on the form. No people tagged =
  a shared company cost across core members (the form's default).
- **Client payments.** The amount is the bill excluding VAT ("received 39,025 in
  the bank" works backwards). VAT 13% when the money arrives in the company
  bank (VAT) account, TDS 1.5% when the client deducts TDS, account = the
  client's default, method = bank transfer, month = the next one due: all the
  Record Payment form's defaults, all shown on the confirmation.
- **Names.** A client, category, vendor, person or account is picked only when
  exactly one fits; otherwise the panel asks.

## Setup

1. **OpenRouter key.** Create a key at openrouter.ai, then in
   **Settings → Privacy** enable Zero Data Retention (every request also asks
   for ZDR routing; `gpt-4.1-mini` is then served by Azure, the speech model by
   DeepInfra). Optionally set a monthly credit limit on the key.
2. **Production.** Add to the Jenkins credential `avernek-expense-tracker-env`:
   ```
   OPENROUTER_API_KEY=sk-or-...
   APP_PORT=3001
   ```
   `APP_PORT` must be in the credential **before** the next step, because a
   sync replaces the server's `.env` with the credential. Then run
   **Build with Parameters → tick `SYNC_ENV_FROM_CREDENTIAL`** (the old `.env`
   is backed up first). The pipeline applies the migration
   `20261015_ai_assistant.sql` (new tables only) after its usual backup.
3. **Local development.** Put `OPENROUTER_API_KEY` in `.env` (never committed).

Without the key the assistant is off: no button, endpoints answer 503.
Removing the key (and syncing) switches it off again; nothing else changes.

## Models and cost

Prices from OpenRouter's catalogue, 15 Oct 2026; check before relying on them.

| Use | Model (env variable) | Price |
|---|---|---|
| Understanding, tool choice | `openai/gpt-4.1-mini` (`AI_PRIMARY_MODEL`) | $0.40 / M input, $1.60 / M output tokens |
| Speech to text | `qwen/qwen3-asr-1.7b` (`AI_TRANSCRIPTION_MODEL`) | ≈ $0.00045 / minute |

A question sends about 5,000 tokens (instructions + tool definitions, which
OpenAI models cache), so it costs roughly $0.002, and about $0.004 when it asks
for an explanation. Forms and confirmations cost nothing (no model call). The
Settings page shows the last 30 days (admins).

## Voice and Nepali

Qwen3-ASR's model card lists 30 languages; **Nepali is not among them** (Hindi
is). Before relying on voice, compare models on real recordings:

```bash
# A folder outside the repo: clip.webm + clip.txt (the exact words) pairs, ~20 of them:
# English, Nepali, mixed, with client names, NPR amounts and dates.
OPENROUTER_API_KEY=... node scripts/ai/compare-transcription.mjs ~/asr-samples
# default candidates: qwen/qwen3-asr-1.7b, openai/whisper-large-v3-turbo, elevenlabs/scribe-v2
```

It prints word and character error rates, whether every number came out right,
cost and latency, and writes every transcript to `transcription-report.json`.
Set the winner as `AI_TRANSCRIPTION_MODEL`. All three have ZDR endpoints and
cost under $0.002 a minute.

Recordings are limited to one minute and 5 MB. The transcript always lands in
the message box for review; voice can never save anything without the same
confirmation as typing.

## Security and privacy

- Endpoints require a session, refuse cross-site requests, and treat model
  output as untrusted input (schema-validated, names resolved, permissions
  checked, writes confirmed).
- Record contents (notes, descriptions) are passed as data; the prompt tells the
  model to ignore instructions in them, and nothing a model does can save
  without a person's click.
- What leaves the server: the question, the last few turns of the
  conversation, the current client's name, and for "why" questions the tools'
  compact results (figures, client and vendor names). No credentials, no raw
  database rows.
- The conversation is kept only in the browser tab (sessionStorage).
- `ai_audit_log` records every request, tool run (with arguments), transcription
  and confirmation, with model, tokens, cost and latency; no message text.
- Not implemented, by decision: rate limits and a spending cap (use the
  OpenRouter key's credit limit). The emergency login bypass
  (`src/lib/auth/bypass.ts`) must stay off: with it on, every visitor is an
  administrator, including in the assistant.

## Tests

`npm test` (also run by the Docker `verify` stage in Jenkins) covers exact money
arithmetic, the shared expense totals (and their agreement with the old
dashboard sums), date and name matching, the agent flow with a scripted model
(one model call for plain questions, permission refusal, one change per
message, confirm-once, cancellation, failures never reported as success), and
the write tools against fixtures with the real `summarizeIncomeAgreement`.

After deploying, check by hand: a spending question against the dashboard; a
client's due-now against the Clients page; "add NPR 100 test expense" →
confirm → it appears on Expenses (then delete it there); a member account cannot
record a payment; voice in Chrome and Safari.

## Adding a tool

Write it in `src/lib/ai/tools/` with a zod schema (its `.describe()` texts are
what the model reads), a permission, and a `run` that uses existing app
functions; a change needs `execute` calling an existing server action. Register
it in `tools/index.ts` and add a test.
