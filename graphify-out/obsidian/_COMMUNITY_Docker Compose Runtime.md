---
type: community
cohesion: 0.24
members: 10
---

# Docker Compose Runtime

**Cohesion:** 0.24 - loosely connected
**Members:** 10 nodes

## Members
- [[20260819_company_funds.sql]] - code - db/migrations/20260819_company_funds.sql
- [[expenses_by_money_account]] - code - db/migrations/20260819_company_funds.sql
- [[income_payments_by_money_account]] - code - db/migrations/20260819_company_funds.sql
- [[money_transfers_by_date]] - code - db/migrations/20260819_company_funds.sql
- [[public]] - code
- [[public.expenses]] - code
- [[public.income_payments]] - code
- [[public.money_accounts]] - code - db/migrations/20260819_company_funds.sql
- [[public.money_transfers]] - code - db/migrations/20260819_company_funds.sql
- [[public.users]] - code

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Docker_Compose_Runtime
SORT file.name ASC
```
