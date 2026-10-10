---
type: community
cohesion: 0.29
members: 10
---

# Backup & Restore Ops

**Cohesion:** 0.29 - loosely connected
**Members:** 10 nodes

## Members
- [[ClientStatusControl()]] - code - src/components/ClientStatusControl.tsx
- [[ClientStatusControl.tsx]] - code - src/components/ClientStatusControl.tsx
- [[IncomeAgreementControls()]] - code - src/components/IncomeAgreementControls.tsx
- [[IncomeAgreementControls.tsx]] - code - src/components/IncomeAgreementControls.tsx
- [[IncomeAgreementStatus]] - code - src/lib/types.ts
- [[changeStatus()]] - code - src/components/ClientStatusControl.tsx
- [[deleteIncomeAgreement()]] - code - src/app/(app)/income/actions.ts
- [[initialState_8]] - code - src/components/IncomeAgreementControls.tsx
- [[options]] - code - src/components/ClientStatusControl.tsx
- [[setIncomeAgreementStatus()]] - code - src/app/(app)/income/actions.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Backup__Restore_Ops
SORT file.name ASC
```

## Connections to other communities
- 11 edges to [[_COMMUNITY_Package Dependencies]]
- 6 edges to [[_COMMUNITY_Income Billing Actions]]
- 6 edges to [[_COMMUNITY_Clients Workspace Page]]
- 6 edges to [[_COMMUNITY_Self-Hosted Supabase Stack]]
- 5 edges to [[_COMMUNITY_Baseline DB Schema]]
- 4 edges to [[_COMMUNITY_Funds & Income Pages]]
- 3 edges to [[_COMMUNITY_Shared Domain Types]]
- 2 edges to [[_COMMUNITY_Expense & Settlement Actions]]
- 1 edge to [[_COMMUNITY_Login & App Shell]]
- 1 edge to [[_COMMUNITY_Dashboard & Expenses Pages]]

## Top bridge nodes
- [[IncomeAgreementControls.tsx]] - degree 19, connects to 8 communities
- [[IncomeAgreementControls()]] - degree 12, connects to 6 communities
- [[ClientStatusControl.tsx]] - degree 10, connects to 4 communities
- [[IncomeAgreementStatus]] - degree 5, connects to 4 communities
- [[setIncomeAgreementStatus()]] - degree 9, connects to 2 communities