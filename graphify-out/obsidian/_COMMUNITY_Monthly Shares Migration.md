---
type: community
cohesion: 0.32
members: 8
---

# Monthly Shares Migration

**Cohesion:** 0.32 - loosely connected
**Members:** 8 nodes

## Members
- [[apihealth Route]] - code - README.md
- [[Build-time vs Runtime Secrets Flow]] - rationale - README.md
- [[DOCKER_BUILD Standalone Gate]] - rationale - README.md
- [[Dockerfile (3-stage build)]] - code - README.md
- [[Jenkinsfile Pipeline]] - code - README.md
- [[Mandatory Rebuild for NEXT_PUBLIC_]] - rationale - docs/SELF-HOSTING.md
- [[Smoke Test Auto-Rollback]] - rationale - README.md
- [[avernek-expense-tracker-env Jenkins Credential]] - concept - docs/SELF-HOSTING.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Monthly_Shares_Migration
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Supabase Key Generator]]
- 1 edge to [[_COMMUNITY_Company Funds Migration]]
- 1 edge to [[_COMMUNITY_Agreement Form Fields]]

## Top bridge nodes
- [[Dockerfile (3-stage build)]] - degree 4, connects to 1 community
- [[Mandatory Rebuild for NEXT_PUBLIC_]] - degree 3, connects to 1 community
- [[apihealth Route]] - degree 3, connects to 1 community
- [[Smoke Test Auto-Rollback]] - degree 3, connects to 1 community