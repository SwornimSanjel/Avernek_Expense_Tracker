-- AI assistant: confirmed financial actions and an audit trail.
-- New tables only; no existing table or row is changed. Safe to run more than once.

-- A financial change the assistant has prepared. Nothing is written to the
-- books until the person who asked confirms it; the confirm endpoint claims a
-- row by moving it from 'pending' to 'executing' in one statement, so a double
-- click, a retry or a second tab can never run the same change twice.
create table if not exists public.ai_pending_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  tool        text not null,
  -- The validated arguments that will be executed, and what the person saw.
  args        jsonb not null,
  summary     jsonb not null,
  status      text not null default 'pending'
                check (status in ('pending', 'executing', 'done', 'failed', 'cancelled')),
  result      jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  decided_at  timestamptz
);

create index if not exists ai_pending_actions_user_idx
  on public.ai_pending_actions (user_id, created_at desc);

-- One row per assistant request, tool run, transcription and confirmation:
-- who, what, the outcome, and the model's tokens, cost and latency. Message
-- text is not stored (conversation history stays in the browser); tool
-- arguments are, because they are what touched the books.
create table if not exists public.ai_audit_log (
  id                 bigserial primary key,
  user_id            uuid references public.users (id) on delete set null,
  kind               text not null
                       check (kind in ('chat', 'tool', 'form', 'confirm', 'transcription')),
  tool               text,
  status             text not null
                       check (status in ('ok', 'needs_input', 'needs_choice', 'denied', 'error', 'cancelled')),
  detail             jsonb,
  model              text,
  prompt_tokens      integer,
  completion_tokens  integer,
  cost_usd           numeric(12, 6),
  latency_ms         integer,
  created_at         timestamptz not null default now()
);

create index if not exists ai_audit_log_created_idx on public.ai_audit_log (created_at desc);
create index if not exists ai_audit_log_user_idx on public.ai_audit_log (user_id, created_at desc);
