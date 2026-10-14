# Graph Report - Expense Tracker  (2026-10-01)

## Corpus Check
- 102 files · ~59,083 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: (none) 5, .example 3, .toml 1)

## Summary
- 699 nodes · 2037 edges · 43 communities (30 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.85)
- Token cost: 125,710 input · 0 output

## Community Hubs (Navigation)
- Expense & Settlement Actions
- Clients Workspace Page
- Dashboard & Expenses Pages
- API Routes & Next Config
- Income Billing Actions
- Package Dependencies
- Admin Seeding & Auth Utils
- Baseline DB Schema
- Login & App Shell
- Agreement Form Fields
- Self-Hosted Supabase Stack
- Income Client Components
- Funds & Income Pages
- Billing Calculation Library
- Company Funds Actions
- TypeScript Config
- Supabase Key Generator
- Shared Domain Types
- Docker Compose Runtime
- Company Funds Migration
- Backup & Restore Ops
- Product Feature Overview
- Supabase Auth & Policies
- Monthly Shares Migration
- Income Tracking Migration
- CI/CD Deploy Pipeline
- Supabase Cloud Migration
- Default Participants Migration
- Client Billing Migration
- Avernek Brand Logo
- DB Restore Script
- Capital Inflow UI
- Local Auth Migration
- CSV Import Script
- PostCSS Config
- Vercel Cron Config

## God Nodes (most connected - your core abstractions)
1. `Icon()` - 43 edges
2. `requireSession()` - 43 edges
3. `exec()` - 38 edges
4. `ClientsPage()` - 31 edges
5. `query()` - 28 edges
6. `react` - 25 edges
7. `ClientBillingPage()` - 25 edges
8. `IncomePage()` - 25 edges
9. `next` - 23 edges
10. `formatIncomeMoney()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `avernek-postgres (postgres:16-alpine)` --semantically_similar_to--> `avernek-supabase-db (supabase/postgres)`  [AMBIGUOUS] [semantically similar]
  docker-compose.yml → docker/supabase/docker-compose.yml
- `Loopback Port + Reverse Proxy` --semantically_similar_to--> `Caddy Reverse Proxy`  [INFERRED] [semantically similar]
  README.md → docs/SELF-HOSTING.md
- `Magic-Link Email Auth` --conceptually_related_to--> `GoTrue auth service`  [INFERRED]
  README.md → docker/supabase/docker-compose.yml
- `Owner-Only Modification Policy` --conceptually_related_to--> `auth.uid() RLS Dependency`  [INFERRED]
  README.md → docs/SELF-HOSTING.md
- `Self-Hosted Supabase Runbook` --references--> `Google OAuth Provider`  [EXTRACTED]
  docs/SELF-HOSTING.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Self-Hosted Supabase Stack** — docker_supabase_docker_compose_db, docker_supabase_docker_compose_auth, docker_supabase_docker_compose_rest, docker_supabase_docker_compose_meta, docker_supabase_docker_compose_studio, docs_self_hosting_caddy [EXTRACTED 1.00]
- **Daily NRB FX Rate Refresh Flow** — readme_fx_refresh_function, docker_compose_fx_cron, docker_fx_cron, readme_api_cron_fx, readme_cron_secret, readme_nrb_rate [EXTRACTED 1.00]
- **Cloud-to-Self-Hosted Data Migration** — docs_self_hosting_cloud_data_migration, docs_self_hosting_on_auth_user_created_trigger, docs_self_hosting_public_users, docs_self_hosting_auth_users, docs_self_hosting_orphan_check, docs_self_hosting_auth_stable_columns_copy [EXTRACTED 1.00]

## Communities (43 total, 13 thin omitted)

### Community 0 - "Expense & Settlement Actions"
Cohesion: 0.10
Nodes (50): addExpense(), deleteExpense(), n(), retryConversion(), toggleReimbursed(), updateExpense(), deleteSettlement(), recordSettlement() (+42 more)

### Community 1 - "Clients Workspace Page"
Cohesion: 0.12
Nodes (53): ActivityCard(), addTotal(), ChannelGroup(), ClientExpense, ClientsPage(), Detail(), dueLabel(), dynamic (+45 more)

### Community 2 - "Dashboard & Expenses Pages"
Cohesion: 0.08
Nodes (43): recharts, dynamic, ExpensesPage(), Dashboard(), dynamic, Empty(), dynamic, SettlementsPage() (+35 more)

### Community 3 - "API Routes & Next Config"
Cohesion: 0.07
Nodes (37): nextConfig, date-fns, next, GET(), GET(), GET(), databaseTarget(), dynamic (+29 more)

### Community 4 - "Income Billing Actions"
Cohesion: 0.14
Nodes (39): addIncomeAgreement(), ADS_STATUSES, AGREEMENT_STATUSES, agreementColumns(), AgreementValues, alreadyPaid(), AUTOMATION_STATUSES, checkbox() (+31 more)

### Community 5 - "Package Dependencies"
Cohesion: 0.06
Nodes (35): dependencies, date-fns, framer-motion, @netlify/plugin-nextjs, next, pg, react, react-dom (+27 more)

### Community 6 - "Admin Seeding & Auth Utils"
Cohesion: 0.11
Nodes (25): pg, client, email, hashPassword(), missing, name, scryptAsync, addCategory() (+17 more)

### Community 7 - "Baseline DB Schema"
Cohesion: 0.16
Nodes (28): capital_inflows_by_account, expense_shares_by_expense, expenses_by_category, expenses_by_date, expenses_by_money_account, expenses_by_payer, fx_rates_lookup, income_agreements_by_client (+20 more)

### Community 8 - "Login & App Shell"
Cohesion: 0.14
Nodes (18): framer-motion, AppLayout(), LoginState, safeNext(), signIn(), signOut(), UserRow, initialState (+10 more)

### Community 9 - "Agreement Form Fields"
Cohesion: 0.13
Nodes (22): accountShortLabel(), Field(), FormSection(), IncomeAgreementFields(), Props, ReviewRow(), ServiceToggle(), ADS_TONE (+14 more)

### Community 10 - "Self-Hosted Supabase Stack"
Cohesion: 0.19
Nodes (14): GoTrue auth service, avernek-supabase-db (supabase/postgres), JWT_SECRET, postgres-meta, avernek-supabase-pgdata volume, PostgREST, SITE_URL / Redirect Allow List, SMTP Mailer Config (+6 more)

### Community 11 - "Income Client Components"
Cohesion: 0.14
Nodes (16): react, IncomeFormState, initialState, options, initialState, initialState, AGREEMENT_STEPS, initialState (+8 more)

### Community 12 - "Funds & Income Pages"
Cohesion: 0.18
Nodes (18): addTotal(), dynamic, FundsPage(), totalsLabel(), accountLabel(), dynamic, Filters, MetricCell() (+10 more)

### Community 13 - "Billing Calculation Library"
Cohesion: 0.14
Nodes (19): addCalendarDays(), addCalendarMonths(), BILLING_STATUS_LABELS, BillingBucket, dateParts(), daysBetween(), isoDate(), RecurringStreamSummary (+11 more)

### Community 14 - "Company Funds Actions"
Cohesion: 0.21
Nodes (17): addCapitalInflow(), addMoneyAccount(), addMoneyTransfer(), CAPITAL_TYPES, deleteCapitalInflow(), FundsFormState, owner(), parseCapital() (+9 more)

### Community 15 - "TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 16 - "Supabase Key Generator"
Cohesion: 0.16
Nodes (5): ANON_KEY / SERVICE_ROLE_KEY JWTs, b64url(), main(), role_key(), sign_jwt()

### Community 17 - "Shared Domain Types"
Cohesion: 0.18
Nodes (11): BillingStatus, BillingStream, Currency, ExpenseFundingSource, ExpenseSource, FxRate, IncomePaymentMethod, IncomeServiceType (+3 more)

### Community 18 - "Docker Compose Runtime"
Cohesion: 0.24
Nodes (10): avernek-postgres (postgres:16-alpine), .env runtime env_file, avernek-fx-cron sidecar, pgdata volume, avernek-expense-tracker web service, fx-cron.sh script, /api/cron/fx Route, CRON_SECRET (+2 more)

### Community 19 - "Company Funds Migration"
Cohesion: 0.24
Nodes (5): expenses_by_money_account, income_payments_by_money_account, money_transfers_by_date, public.money_accounts, public.money_transfers

### Community 20 - "Backup & Restore Ops"
Cohesion: 0.24
Nodes (6): DB Backup/Restore Scripts, Self-Hosted Supabase (optional), dc(), db-backup.sh script, drill_q(), db-restore-drill.sh script

### Community 21 - "Product Feature Overview"
Cohesion: 0.22
Nodes (7): Avernek Expense Tracker, Filters + CSV Export, Dashboard, Investment Contributions, Next.js App Router, Pending Expense Status, Subscriptions

### Community 22 - "Supabase Auth & Policies"
Cohesion: 0.22
Nodes (8): DATABASE_URL / SESSION_SECRET auth model, Google OAuth Provider, Magic-Link Email Auth, Receipts Storage Bucket, supabase/schema.sql, supabase/seed.sql, Supabase (Postgres, Auth, RLS), Team Access Owner Controls Migration

### Community 23 - "Monthly Shares Migration"
Cohesion: 0.36
Nodes (4): expense_shares_by_expense, public.expense_shares, public.recurring_shares, recurring_shares_by_recurring

### Community 24 - "Income Tracking Migration"
Cohesion: 0.46
Nodes (6): income_agreements_by_client, income_agreements_by_status, income_payments_by_agreement, income_payments_by_period, public.income_agreements, public.income_payments

### Community 25 - "CI/CD Deploy Pipeline"
Cohesion: 0.32
Nodes (4): avernek-expense-tracker-env Jenkins Credential, /api/health Route, Dockerfile (3-stage build), Jenkinsfile Pipeline

### Community 26 - "Supabase Cloud Migration"
Cohesion: 0.48
Nodes (4): auth.users, on_auth_user_created Trigger, public.expenses, public.users

### Community 29 - "Avernek Brand Logo"
Cohesion: 0.50
Nodes (4): Avernek Logo Image, Avernek 'A' Monogram Brand Mark, Avernek Brand, Violet-to-Purple Gradient on Near-Black Palette

### Community 30 - "DB Restore Script"
Cohesion: 1.00
Nodes (3): dc(), psql_q(), db-restore.sh script

### Community 31 - "Capital Inflow UI"
Cohesion: 0.50
Nodes (3): initialState, CAPITAL_INFLOW_LABELS, CapitalInflowType

## Ambiguous Edges - Review These
- `Supabase (Postgres, Auth, RLS)` → `DATABASE_URL / SESSION_SECRET auth model`  [AMBIGUOUS]
  docker-compose.yml · relation: conceptually_related_to
- `avernek-postgres (postgres:16-alpine)` → `avernek-supabase-db (supabase/postgres)`  [AMBIGUOUS]
  docker-compose.yml · relation: semantically_similar_to

## Knowledge Gaps
- **134 isolated node(s):** `fx-cron.sh script`, `nextConfig`, `name`, `version`, `private` (+129 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 186 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Supabase (Postgres, Auth, RLS)` and `DATABASE_URL / SESSION_SECRET auth model`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `avernek-postgres (postgres:16-alpine)` and `avernek-supabase-db (supabase/postgres)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **Why does `next` connect `API Routes & Next Config` to `Expense & Settlement Actions`, `Clients Workspace Page`, `Dashboard & Expenses Pages`, `Income Billing Actions`, `Package Dependencies`, `Admin Seeding & Auth Utils`, `Login & App Shell`, `Income Client Components`, `Funds & Income Pages`, `Company Funds Actions`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `react` connect `Income Client Components` to `Expense & Settlement Actions`, `Clients Workspace Page`, `Dashboard & Expenses Pages`, `Package Dependencies`, `Admin Seeding & Auth Utils`, `Login & App Shell`, `Agreement Form Fields`, `Company Funds Actions`, `Shared Domain Types`, `Capital Inflow UI`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `requireSession()` connect `Expense & Settlement Actions` to `Clients Workspace Page`, `Dashboard & Expenses Pages`, `API Routes & Next Config`, `Income Billing Actions`, `Admin Seeding & Auth Utils`, `Login & App Shell`, `Funds & Income Pages`, `Company Funds Actions`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `fx-cron.sh script`, `nextConfig`, `name` to the rest of the system?**
  _134 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Expense & Settlement Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.09951923076923076 - nodes in this community are weakly interconnected._