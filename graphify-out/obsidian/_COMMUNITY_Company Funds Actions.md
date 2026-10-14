---
type: community
cohesion: 0.16
members: 15
---

# Company Funds Actions

**Cohesion:** 0.16 - loosely connected
**Members:** 15 nodes

## Members
- [[ANON_KEY  SERVICE_ROLE_KEY JWTs]] - concept - docs/SELF-HOSTING.md
- [[Generate the secrets the self-hosted Supabase stack needs. Hosted Supabase…]] - rationale - scripts/supabase-keys.py
- [[JWTs use base64url with the padding stripped.]] - rationale - scripts/supabase-keys.py
- [[argparse]] - concept
- [[b64url()]] - code - scripts/supabase-keys.py
- [[base64]] - concept
- [[hashlib]] - concept
- [[hmac]] - concept
- [[json]] - concept
- [[main()]] - code - scripts/supabase-keys.py
- [[role_key()]] - code - scripts/supabase-keys.py
- [[secrets]] - concept
- [[sign_jwt()]] - code - scripts/supabase-keys.py
- [[supabase-keys.py]] - code - scripts/supabase-keys.py
- [[time]] - concept

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Company_Funds_Actions
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Agreement Form Fields]]

## Top bridge nodes
- [[supabase-keys.py]] - degree 14, connects to 1 community
- [[ANON_KEY  SERVICE_ROLE_KEY JWTs]] - degree 2, connects to 1 community