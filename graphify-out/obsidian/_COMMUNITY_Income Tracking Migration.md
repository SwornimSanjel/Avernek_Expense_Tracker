---
type: community
cohesion: 0.48
members: 7
---

# Income Tracking Migration

**Cohesion:** 0.48 - moderately connected
**Members:** 7 nodes

## Members
- [[Auth Users Stable-Column Copy]] - rationale - docs/SELF-HOSTING.md
- [[Migration from Supabase Cloud]] - rationale - docs/SELF-HOSTING.md
- [[Orphaned Expenses Verification]] - rationale - docs/SELF-HOSTING.md
- [[auth.users]] - code - docs/SELF-HOSTING.md
- [[on_auth_user_created Trigger]] - code - docs/SELF-HOSTING.md
- [[public.expenses_4]] - code - docs/SELF-HOSTING.md
- [[public.users_7]] - code - docs/SELF-HOSTING.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Income_Tracking_Migration
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_Agreement Form Fields]]

## Top bridge nodes
- [[Migration from Supabase Cloud]] - degree 6, connects to 1 community