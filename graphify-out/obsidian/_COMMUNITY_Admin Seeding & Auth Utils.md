---
type: community
cohesion: 0.16
members: 30
---

# Admin Seeding & Auth Utils

**Cohesion:** 0.16 - loosely connected
**Members:** 30 nodes

## Members
- [[capital_inflows_by_account_1]] - code - db/schema.sql
- [[expense_shares_by_expense_1]] - code - db/schema.sql
- [[expenses_by_category]] - code - db/schema.sql
- [[expenses_by_date]] - code - db/schema.sql
- [[expenses_by_money_account_1]] - code - db/schema.sql
- [[expenses_by_payer]] - code - db/schema.sql
- [[fx_rates_lookup]] - code - db/schema.sql
- [[income_agreements_by_client_1]] - code - db/schema.sql
- [[income_agreements_by_status_1]] - code - db/schema.sql
- [[income_payments_by_agreement_1]] - code - db/schema.sql
- [[income_payments_by_money_account_1]] - code - db/schema.sql
- [[income_payments_by_period_1]] - code - db/schema.sql
- [[money_transfers_by_date_1]] - code - db/schema.sql
- [[public_2]] - code
- [[public.capital_inflows_1]] - code - db/schema.sql
- [[public.categories]] - code - db/schema.sql
- [[public.expense_shares_2]] - code - db/schema.sql
- [[public.expenses_3]] - code - db/schema.sql
- [[public.fx_rates]] - code - db/schema.sql
- [[public.income_agreements_2]] - code - db/schema.sql
- [[public.income_payments_3]] - code - db/schema.sql
- [[public.money_accounts_2]] - code - db/schema.sql
- [[public.money_transfers_1]] - code - db/schema.sql
- [[public.recurring_2]] - code - db/schema.sql
- [[public.recurring_shares_2]] - code - db/schema.sql
- [[public.settlements]] - code - db/schema.sql
- [[public.users_6]] - code - db/schema.sql
- [[public.vendors]] - code - db/schema.sql
- [[recurring_shares_by_recurring_1]] - code - db/schema.sql
- [[schema.sql]] - code - db/schema.sql

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Admin_Seeding__Auth_Utils
SORT file.name ASC
```
