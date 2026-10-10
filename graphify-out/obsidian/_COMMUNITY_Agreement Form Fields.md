---
type: community
cohesion: 0.17
members: 24
---

# Agreement Form Fields

**Cohesion:** 0.17 - loosely connected
**Members:** 24 nodes

## Members
- [[00-roles.sql]] - code - docker/supabase/init/00-roles.sql
- [[01-auth-helpers.sql]] - code - docker/supabase/init/01-auth-helpers.sql
- [[ADDITIONAL_REDIRECT_URLS Allow List]] - concept - docs/SELF-HOSTING.md
- [[CORS Header Handling]] - rationale - docs/SELF-HOSTING.md
- [[Caddy Reverse Proxy]] - concept - docs/SELF-HOSTING.md
- [[GoTrue auth service]] - code - docker/supabase/docker-compose.yml
- [[JWT_SECRET]] - concept - docker/supabase/docker-compose.yml
- [[Kong Gateway (omitted)]] - concept - docs/SELF-HOSTING.md
- [[Owner-Only Modification Policy]] - rationale - README.md
- [[PostgREST]] - code - docker/supabase/docker-compose.yml
- [[Reduced Supabase Stack]] - rationale - docker/supabase/docker-compose.yml
- [[SITE_URL  Redirect Allow List]] - concept - docker/supabase/docker-compose.yml
- [[SMTP Mailer Config]] - concept - docker/supabase/docker-compose.yml
- [[Self-Hosted Supabase Runbook]] - document - docs/SELF-HOSTING.md
- [[Studio Basic Auth]] - rationale - docs/SELF-HOSTING.md
- [[Supabase Studio]] - code - docker/supabase/docker-compose.yml
- [[Team Access Owner Controls Migration]] - code - README.md
- [[auth.jwt()]] - code - docker/supabase/init/01-auth-helpers.sql
- [[auth.uid()]] - code - docker/supabase/init/01-auth-helpers.sql
- [[auth.uid() RLS Dependency]] - concept - docs/SELF-HOSTING.md
- [[avernek-supabase-db (supabasepostgres)]] - code - docker/supabase/docker-compose.yml
- [[avernek-supabase-pgdata volume]] - code - docker/supabase/docker-compose.yml
- [[postgres-meta]] - code - docker/supabase/docker-compose.yml
- [[supabaseschema.sql]] - code - README.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Agreement_Form_Fields
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Company Funds Migration]]
- 3 edges to [[_COMMUNITY_TypeScript Config]]
- 2 edges to [[_COMMUNITY_Company Funds Actions]]
- 2 edges to [[_COMMUNITY_Supabase Key Generator]]
- 1 edge to [[_COMMUNITY_Client Billing Migration]]
- 1 edge to [[_COMMUNITY_Monthly Shares Migration]]
- 1 edge to [[_COMMUNITY_Income Tracking Migration]]

## Top bridge nodes
- [[Self-Hosted Supabase Runbook]] - degree 21, connects to 6 communities
- [[avernek-supabase-db (supabasepostgres)]] - degree 11, connects to 1 community
- [[GoTrue auth service]] - degree 8, connects to 1 community
- [[Caddy Reverse Proxy]] - degree 6, connects to 1 community
- [[JWT_SECRET]] - degree 5, connects to 1 community