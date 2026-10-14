---
source_file: "db/migrations/20260819_company_funds.sql"
type: "code"
community: "Docker Compose Runtime"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/Docker_Compose_Runtime
---

# 20260819_company_funds.sql

## Connections
- [[expenses_by_money_account]] - `contains` [EXTRACTED]
- [[income_payments_by_money_account]] - `contains` [EXTRACTED]
- [[money_transfers_by_date]] - `contains` [EXTRACTED]
- [[public.money_accounts]] - `contains` [EXTRACTED]
- [[public.money_transfers]] - `contains` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/Docker_Compose_Runtime