---
type: community
cohesion: 0.24
members: 10
---

# Company Funds Migration

**Cohesion:** 0.24 - loosely connected
**Members:** 10 nodes

## Members
- [[DB BackupRestore Scripts]] - code - README.md
- [[Off-box Backup Retention]] - rationale - docs/SELF-HOSTING.md
- [[Self-Hosted Supabase (optional)]] - concept - README.md
- [[cleanup()]] - code - scripts/db-restore-drill.sh
- [[db-backup.sh]] - code - scripts/db-backup.sh
- [[db-backup.sh script]] - code - scripts/db-backup.sh
- [[db-restore-drill.sh]] - code - scripts/db-restore-drill.sh
- [[db-restore-drill.sh script]] - code - scripts/db-restore-drill.sh
- [[dc()]] - code - scripts/db-backup.sh
- [[drill_q()]] - code - scripts/db-restore-drill.sh

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Company_Funds_Migration
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Agreement Form Fields]]
- 1 edge to [[_COMMUNITY_Monthly Shares Migration]]

## Top bridge nodes
- [[db-restore-drill.sh]] - degree 6, connects to 2 communities
- [[db-backup.sh]] - degree 6, connects to 1 community
- [[Self-Hosted Supabase (optional)]] - degree 2, connects to 1 community