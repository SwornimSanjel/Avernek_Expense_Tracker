---
type: community
cohesion: 0.10
members: 28
---

# Login & App Shell

**Cohesion:** 0.10 - loosely connected
**Members:** 28 nodes

## Members
- [[ADS_STATUS_LABELS]] - code - src/lib/income.ts
- [[ADS_TONE]] - code - src/components/StatusPill.tsx
- [[AGREEMENT_STATUS_LABELS]] - code - src/lib/income.ts
- [[AGREEMENT_TONE]] - code - src/components/StatusPill.tsx
- [[AUTOMATION_STATUS_LABELS]] - code - src/lib/income.ts
- [[AUTOMATION_TONE]] - code - src/components/StatusPill.tsx
- [[AdsStatus]] - code - src/lib/types.ts
- [[AutomationStatus]] - code - src/lib/types.ts
- [[BILLING_STATUS_LABELS]] - code - src/lib/income.ts
- [[BILLING_TONE]] - code - src/components/StatusPill.tsx
- [[BillingBucket]] - code - src/lib/income.ts
- [[BillingStatus]] - code - src/lib/types.ts
- [[RecurringPeriod]] - code - src/lib/income.ts
- [[RecurringStreamSummary]] - code - src/lib/income.ts
- [[SERVICE_BADGES]] - code - src/lib/income.ts
- [[SERVICE_KEYS]] - code - src/lib/income.ts
- [[SERVICE_LABELS]] - code - src/lib/income.ts
- [[STATUS_SEVERITY]] - code - src/lib/income.ts
- [[ServiceBadges.tsx]] - code - src/components/ServiceBadges.tsx
- [[ServiceKey]] - code - src/lib/types.ts
- [[StatusPill.tsx]] - code - src/components/StatusPill.tsx
- [[Tone]] - code - src/components/StatusPill.tsx
- [[WEBSITE_STATUS_LABELS]] - code - src/lib/income.ts
- [[WEBSITE_TONE]] - code - src/components/StatusPill.tsx
- [[WebsiteStatus]] - code - src/lib/types.ts
- [[income.ts]] - code - src/lib/income.ts
- [[resolve()]] - code - src/components/StatusPill.tsx
- [[serviceTypeLabel()]] - code - src/lib/income.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Login__App_Shell
SORT file.name ASC
```

## Connections to other communities
- 24 edges to [[_COMMUNITY_Baseline DB Schema]]
- 17 edges to [[_COMMUNITY_Funds & Income Pages]]
- 11 edges to [[_COMMUNITY_Self-Hosted Supabase Stack]]
- 9 edges to [[_COMMUNITY_Income Billing Actions]]
- 9 edges to [[_COMMUNITY_Shared Domain Types]]
- 7 edges to [[_COMMUNITY_Package Dependencies]]
- 3 edges to [[_COMMUNITY_Income Client Components]]
- 2 edges to [[_COMMUNITY_Clients Workspace Page]]
- 1 edge to [[_COMMUNITY_Backup & Restore Ops]]

## Top bridge nodes
- [[income.ts]] - degree 67, connects to 8 communities
- [[StatusPill.tsx]] - degree 23, connects to 5 communities
- [[ServiceBadges.tsx]] - degree 8, connects to 4 communities
- [[AGREEMENT_STATUS_LABELS]] - degree 5, connects to 3 communities
- [[AdsStatus]] - degree 5, connects to 3 communities