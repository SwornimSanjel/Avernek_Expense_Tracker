---
type: community
cohesion: 1.00
members: 3
---

# DB Restore Script

**Cohesion:** 1.00 - tightly connected
**Members:** 3 nodes

## Members
- [[import-csvs.sh]] - code - scripts/import-csvs.sh
- [[import-csvs.sh script]] - code - scripts/import-csvs.sh
- [[psql_db()]] - code - scripts/import-csvs.sh

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/DB_Restore_Script
SORT file.name ASC
```
