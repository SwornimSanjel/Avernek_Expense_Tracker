---
source_file: "db/migrations/20260819_company_funds.sql"
type: "code"
community: "Docker Compose Runtime"
location: "L86"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/Docker_Compose_Runtime
---

# public.money_transfers

## Connections
- [[20260819_company_funds.sql]] - `contains` [EXTRACTED]
- [[money_transfers_by_date]] - `indexes` [EXTRACTED]
- [[public]] - `references` [EXTRACTED]
- [[public.money_accounts]] - `references` [EXTRACTED]
- [[public.users]] - `references` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/Docker_Compose_Runtime