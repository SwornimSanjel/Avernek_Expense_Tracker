---
type: community
cohesion: 0.13
members: 30
---

# Baseline DB Schema

**Cohesion:** 0.13 - loosely connected
**Members:** 30 nodes

## Members
- [[AGREEMENT_STEPS]] - code - src/components/IncomeAgreementFields.tsx
- [[AddIncomeAgreement.tsx]] - code - src/components/AddIncomeAgreement.tsx
- [[Field()_1]] - code - src/components/IncomeAgreementFields.tsx
- [[FormSection()]] - code - src/components/IncomeAgreementFields.tsx
- [[IncomeAgreementFields()]] - code - src/components/IncomeAgreementFields.tsx
- [[IncomeAgreementFields.tsx]] - code - src/components/IncomeAgreementFields.tsx
- [[IncomeFormState]] - code - src/app/(app)/income/actions.ts
- [[MarkServiceLive()_1]] - code - src/components/MarkServiceLive.tsx
- [[MarkServiceLive.tsx]] - code - src/components/MarkServiceLive.tsx
- [[Props]] - code - src/components/IncomeAgreementFields.tsx
- [[ReviewRow()]] - code - src/components/IncomeAgreementFields.tsx
- [[ServiceToggle()]] - code - src/components/IncomeAgreementFields.tsx
- [[accountShortLabel()]] - code - src/components/IncomeAgreementFields.tsx
- [[addCalendarDays()]] - code - src/lib/income.ts
- [[addCalendarMonths()]] - code - src/lib/income.ts
- [[billingStatus()]] - code - src/lib/income.ts
- [[buildBucket()]] - code - src/lib/income.ts
- [[dateParts()]] - code - src/lib/income.ts
- [[daysBetween()]] - code - src/lib/income.ts
- [[formatServiceDate()]] - code - src/lib/income.ts
- [[initialState_9]] - code - src/components/AddIncomeAgreement.tsx
- [[initialState_10]] - code - src/components/MarkServiceLive.tsx
- [[isValidDate()]] - code - src/lib/income.ts
- [[isoDate()]] - code - src/lib/income.ts
- [[paidInFullDate()]] - code - src/lib/income.ts
- [[streamLabel()]] - code - src/lib/income.ts
- [[suggestedBillingStart()]] - code - src/lib/income.ts
- [[summarizeStream()]] - code - src/lib/income.ts
- [[todayIso()]] - code - src/lib/income.ts
- [[utcDate()]] - code - src/lib/income.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Baseline_DB_Schema
SORT file.name ASC
```

## Connections to other communities
- 24 edges to [[_COMMUNITY_Login & App Shell]]
- 19 edges to [[_COMMUNITY_Funds & Income Pages]]
- 18 edges to [[_COMMUNITY_Package Dependencies]]
- 9 edges to [[_COMMUNITY_Income Billing Actions]]
- 8 edges to [[_COMMUNITY_Shared Domain Types]]
- 6 edges to [[_COMMUNITY_Self-Hosted Supabase Stack]]
- 5 edges to [[_COMMUNITY_Backup & Restore Ops]]
- 1 edge to [[_COMMUNITY_Clients Workspace Page]]
- 1 edge to [[_COMMUNITY_Income Client Components]]
- 1 edge to [[_COMMUNITY_Dashboard & Expenses Pages]]

## Top bridge nodes
- [[IncomeAgreementFields.tsx]] - degree 33, connects to 5 communities
- [[AddIncomeAgreement.tsx]] - degree 14, connects to 5 communities
- [[todayIso()]] - degree 13, connects to 5 communities
- [[formatServiceDate()]] - degree 16, connects to 4 communities
- [[MarkServiceLive.tsx]] - degree 13, connects to 4 communities