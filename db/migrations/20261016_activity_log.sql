-- =============================================================================
-- Activity log: who added, edited, deleted or uploaded what, and when.
--
-- Recorded by a trigger on every table that holds money or records, so no
-- screen, bulk action or AI tool can change data without leaving a line here.
-- The app tells Postgres who is acting with set_config('app.actor_id' /
-- 'app.actor_name') inside the same transaction (see lib/db.ts); writes with no
-- signed-in person (cron, scripts) are logged as "System".
--
-- Never stored: file bytes (attachments.data) and password hashes.
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.activity_log (
  id          bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  table_name  text not null,
  operation   text not null check (operation in ('insert','update','delete','sign_in')),
  record_id   text,
  summary     text,
  amount      numeric(14,2),
  changes     jsonb
);

create index if not exists activity_log_by_time  on public.activity_log (occurred_at desc);
create index if not exists activity_log_by_actor on public.activity_log (actor_id, occurred_at desc);
create index if not exists activity_log_by_table on public.activity_log (table_name, occurred_at desc);

create or replace function public.log_activity() returns trigger
language plpgsql as $$
declare
  ignored  text[] := array['updated_at','updated_by','created_at','data','password_hash',
                           'last_login_at','fx_rate_date','search_text'];
  new_row  jsonb;
  old_row  jsonb;
  row_data jsonb;
  diff     jsonb := '{}'::jsonb;
  k        text;
  label    text;
  money    numeric;
  actor    text := nullif(current_setting('app.actor_id', true), '');
begin
  if TG_TABLE_NAME = 'attachments' then
    -- Never turn file bytes into JSON: pick the descriptive columns only.
    if TG_OP <> 'INSERT' then
      old_row := jsonb_build_object('id', OLD.id, 'kind', OLD.kind, 'file_name', OLD.file_name,
                                    'size_bytes', OLD.size_bytes, 'expense_id', OLD.expense_id,
                                    'agreement_id', OLD.agreement_id, 'company_bill_id', OLD.company_bill_id);
    end if;
    if TG_OP <> 'DELETE' then
      new_row := jsonb_build_object('id', NEW.id, 'kind', NEW.kind, 'file_name', NEW.file_name,
                                    'size_bytes', NEW.size_bytes, 'expense_id', NEW.expense_id,
                                    'agreement_id', NEW.agreement_id, 'company_bill_id', NEW.company_bill_id);
    end if;
  else
    if TG_OP <> 'INSERT' then old_row := to_jsonb(OLD) - ignored; end if;
    if TG_OP <> 'DELETE' then new_row := to_jsonb(NEW) - ignored; end if;
  end if;
  row_data := coalesce(new_row, old_row);

  if TG_OP = 'UPDATE' then
    for k in select jsonb_object_keys(new_row) loop
      if new_row -> k is distinct from old_row -> k then
        diff := diff || jsonb_build_object(k, jsonb_build_array(old_row -> k, new_row -> k));
      end if;
    end loop;
    -- A save that changed nothing meaningful (e.g. only a timestamp) is noise.
    if diff = '{}'::jsonb then return null; end if;
  end if;

  label := coalesce(
    row_data ->> 'client_name',
    row_data ->> 'description',
    row_data ->> 'borrower_name',
    row_data ->> 'file_name',
    row_data ->> 'name',
    row_data ->> 'note',
    row_data ->> 'client',
    row_data ->> 'period_label',
    row_data ->> 'inflow_type',
    row_data ->> 'email'
  );
  if TG_TABLE_NAME = 'income_payments' then
    select a.client_name into label
      from public.income_agreements a where a.id = (row_data ->> 'agreement_id')::uuid;
    label := coalesce(label, 'Client') || ' · ' || coalesce(row_data ->> 'payment_for', 'payment');
  end if;

  begin
    money := coalesce(
      row_data ->> 'amount',
      row_data ->> 'total_amount',
      row_data ->> 'from_amount',
      row_data ->> 'amount_npr'
    )::numeric;
  exception when others then
    money := null;
  end;

  insert into public.activity_log
    (actor_id, actor_name, table_name, operation, record_id, summary, amount, changes)
  values (
    case when actor ~ '^[0-9a-f-]{36}$' then actor::uuid end,
    coalesce(nullif(current_setting('app.actor_name', true), ''), 'System'),
    TG_TABLE_NAME,
    lower(TG_OP),
    row_data ->> 'id',
    left(label, 200),
    money,
    case when TG_OP = 'UPDATE' then diff end
  );
  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'expenses','income_agreements','income_payments','other_income','money_transfers',
    'capital_inflows','company_bills','tax_payments','money_loans','money_accounts',
    'recurring','settlements','attachments','categories','users','vendors'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists activity_log_%1$s on public.%1$I', t);
      execute format(
        'create trigger activity_log_%1$s after insert or update or delete on public.%1$I
           for each row execute function public.log_activity()', t);
    end if;
  end loop;
end $$;
