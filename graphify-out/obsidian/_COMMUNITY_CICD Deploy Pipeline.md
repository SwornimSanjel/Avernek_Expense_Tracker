---
type: community
cohesion: 0.40
members: 6
---

# CI/CD Deploy Pipeline

**Cohesion:** 0.40 - moderately connected
**Members:** 6 nodes

## Members
- [[20260712_add_default_participants.sql]] - code - db/migrations/20260712_add_default_participants.sql
- [[public.expense_shares_1]] - code - db/migrations/20260712_add_default_participants.sql
- [[public.expenses_2]] - code
- [[public.recurring_1]] - code
- [[public.recurring_shares_1]] - code - db/migrations/20260712_add_default_participants.sql
- [[public.users_3]] - code

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/CI/CD_Deploy_Pipeline
SORT file.name ASC
```
