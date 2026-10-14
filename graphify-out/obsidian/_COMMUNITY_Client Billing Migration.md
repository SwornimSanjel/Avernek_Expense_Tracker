---
type: community
cohesion: 1.00
members: 4
---

# Client Billing Migration

**Cohesion:** 1.00 - tightly connected
**Members:** 4 nodes

## Members
- [[db-restore.sh]] - code - scripts/db-restore.sh
- [[db-restore.sh script]] - code - scripts/db-restore.sh
- [[dc()_1]] - code - scripts/db-restore.sh
- [[psql_q()]] - code - scripts/db-restore.sh

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Client_Billing_Migration
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_Agreement Form Fields]]

## Top bridge nodes
- [[db-restore.sh]] - degree 4, connects to 1 community