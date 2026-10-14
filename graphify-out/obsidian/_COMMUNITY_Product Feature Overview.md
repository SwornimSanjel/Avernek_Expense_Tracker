---
type: community
cohesion: 0.36
members: 8
---

# Product Feature Overview

**Cohesion:** 0.36 - loosely connected
**Members:** 8 nodes

## Members
- [[20260712_add_monthly_shares.sql]] - code - db/migrations/20260712_add_monthly_shares.sql
- [[expense_shares_by_expense]] - code - db/migrations/20260712_add_monthly_shares.sql
- [[public.expense_shares]] - code - db/migrations/20260712_add_monthly_shares.sql
- [[public.expenses_1]] - code
- [[public.recurring]] - code
- [[public.recurring_shares]] - code - db/migrations/20260712_add_monthly_shares.sql
- [[public.users_1]] - code
- [[recurring_shares_by_recurring]] - code - db/migrations/20260712_add_monthly_shares.sql

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Product_Feature_Overview
SORT file.name ASC
```
