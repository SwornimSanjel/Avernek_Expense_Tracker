---
type: community
cohesion: 0.08
members: 81
---

# Expense & Settlement Actions

**Cohesion:** 0.08 - loosely connected
**Members:** 81 nodes

## Members
- [[AddMemberForm()]] - code - src/components/AddMemberForm.tsx
- [[AddMemberForm.tsx]] - code - src/components/AddMemberForm.tsx
- [[ConversionInput]] - code - src/lib/fx.ts
- [[ConversionResult]] - code - src/lib/fx.ts
- [[ExpenseRowActions()]] - code - src/components/ExpenseRowActions.tsx
- [[ExpenseShare]] - code - src/lib/types.ts
- [[FxRateRow]] - code - src/lib/fx.ts
- [[GET()]] - code - src/app/api/cron/fx/route.ts
- [[GET()_1]] - code - src/app/api/fx/route.ts
- [[MemberState]] - code - src/app/(app)/settings/actions.ts
- [[Queryable]] - code - src/lib/db.ts
- [[RecurringRow()]] - code - src/components/RecurringRow.tsx
- [[Row]] - code - src/lib/db.ts
- [[SetPasswordForm()]] - code - src/components/SetPasswordForm.tsx
- [[SetPasswordForm.tsx]] - code - src/components/SetPasswordForm.tsx
- [[SettlementRowActions()]] - code - src/components/SettlementRowActions.tsx
- [[SettlementRowActions.tsx]] - code - src/components/SettlementRowActions.tsx
- [[ShareInput]] - code - src/lib/shares.ts
- [[UsdRate]] - code - src/lib/fx.ts
- [[addCategory()]] - code - src/app/(app)/settings/actions.ts
- [[addExpense()]] - code - src/app/(app)/expenses/actions.ts
- [[addMember()]] - code - src/app/(app)/settings/actions.ts
- [[addRecurring()]] - code - src/app/(app)/subscriptions/actions.ts
- [[apifxroute.ts]] - code - src/app/api/fx/route.ts
- [[assertAppOwner()]] - code - src/lib/authz.ts
- [[assertCanManageExpenses]] - code - src/lib/authz.ts
- [[billingMonthDate()]] - code - src/lib/shares.ts
- [[cacheNrbUsd()]] - code - src/lib/fx.ts
- [[cachedUsdOnOrBefore()]] - code - src/lib/fx.ts
- [[createPool()]] - code - src/lib/db.ts
- [[cronfxroute.ts]] - code - src/app/api/cron/fx/route.ts
- [[date-fns]] - concept - package.json
- [[db.ts]] - code - src/lib/db.ts
- [[deleteExpense()]] - code - src/app/(app)/expenses/actions.ts
- [[deleteRecurring()]] - code - src/app/(app)/subscriptions/actions.ts
- [[deleteSettlement()]] - code - src/app/(app)/settlements/actions.ts
- [[exec()]] - code - src/lib/db.ts
- [[expensesactions.ts]] - code - src/app/(app)/expenses/actions.ts
- [[fetchNrbUsd()]] - code - src/lib/fx.ts
- [[fx.ts]] - code - src/lib/fx.ts
- [[getCurrentUsdSellRate()]] - code - src/lib/fx.ts
- [[getPool()]] - code - src/lib/db.ts
- [[getUsdSellRateForDate()]] - code - src/lib/fx.ts
- [[globalForPool]] - code - src/lib/db.ts
- [[hashPassword()]] - code - src/lib/auth/password.ts
- [[ident()]] - code - src/lib/db.ts
- [[initialState]] - code - src/components/AddMemberForm.tsx
- [[initialState_1]] - code - src/components/SetPasswordForm.tsx
- [[insertRows()]] - code - src/lib/db.ts
- [[logRenewalPaid()]] - code - src/app/(app)/subscriptions/actions.ts
- [[n()]] - code - src/app/(app)/expenses/actions.ts
- [[n()_1]] - code - src/app/(app)/subscriptions/actions.ts
- [[num()]] - code - src/lib/fx.ts
- [[readShareInputs()]] - code - src/lib/shares.ts
- [[recordSettlement()]] - code - src/app/(app)/settlements/actions.ts
- [[requireOwner()]] - code - src/app/(app)/settings/actions.ts
- [[requireSession()]] - code - src/lib/auth/server.ts
- [[resolveConversion()]] - code - src/lib/fx.ts
- [[retryConversion()]] - code - src/app/(app)/expenses/actions.ts
- [[round2()]] - code - src/lib/fx.ts
- [[round2()_1]] - code - src/lib/shares.ts
- [[round6()]] - code - src/lib/fx.ts
- [[setBudget()]] - code - src/app/(app)/settings/actions.ts
- [[setCoreMember()]] - code - src/app/(app)/settings/actions.ts
- [[setMemberPassword()]] - code - src/app/(app)/settings/actions.ts
- [[settingsactions.ts]] - code - src/app/(app)/settings/actions.ts
- [[settlementsactions.ts]] - code - src/app/(app)/settlements/actions.ts
- [[shareRows()]] - code - src/app/(app)/subscriptions/actions.ts
- [[shares.ts]] - code - src/lib/shares.ts
- [[subscriptionsactions.ts]] - code - src/app/(app)/subscriptions/actions.ts
- [[toExpenseShareRows()]] - code - src/lib/shares.ts
- [[toggleActive()]] - code - src/app/(app)/subscriptions/actions.ts
- [[toggleReimbursed()]] - code - src/app/(app)/expenses/actions.ts
- [[transaction()]] - code - src/lib/db.ts
- [[updateExpense()]] - code - src/app/(app)/expenses/actions.ts
- [[updateMyName()]] - code - src/app/(app)/settings/actions.ts
- [[updateRecurring()]] - code - src/app/(app)/subscriptions/actions.ts
- [[updateRow()]] - code - src/lib/db.ts
- [[updateSettlement()]] - code - src/app/(app)/settlements/actions.ts
- [[validatePassword()]] - code - src/lib/auth/password.ts
- [[validateShareTotal()]] - code - src/lib/shares.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Expense__Settlement_Actions
SORT file.name ASC
```

## Connections to other communities
- 55 edges to [[_COMMUNITY_Clients Workspace Page]]
- 39 edges to [[_COMMUNITY_Income Billing Actions]]
- 30 edges to [[_COMMUNITY_Dashboard & Expenses Pages]]
- 13 edges to [[_COMMUNITY_Package Dependencies]]
- 12 edges to [[_COMMUNITY_Income Client Components]]
- 3 edges to [[_COMMUNITY_Self-Hosted Supabase Stack]]
- 3 edges to [[_COMMUNITY_Funds & Income Pages]]
- 3 edges to [[_COMMUNITY_Shared Domain Types]]
- 2 edges to [[_COMMUNITY_Backup & Restore Ops]]
- 2 edges to [[_COMMUNITY_API Routes & Next Config]]

## Top bridge nodes
- [[db.ts]] - degree 34, connects to 9 communities
- [[requireSession()]] - degree 43, connects to 7 communities
- [[exec()]] - degree 38, connects to 4 communities
- [[subscriptionsactions.ts]] - degree 35, connects to 3 communities
- [[expensesactions.ts]] - degree 32, connects to 3 communities