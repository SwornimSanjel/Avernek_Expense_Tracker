-- Phone balance used for sales calls, cold calls, and client calls.
-- Safe to run more than once.

insert into public.categories (name, color)
values ('Phone / Recharge', '#0f766e')
on conflict (name) do nothing;

insert into public.vendors (name, category_id, default_currency)
select 'Mobile Recharge', id, 'NPR'
from public.categories
where name = 'Phone / Recharge'
on conflict (name) do update
set category_id = excluded.category_id,
    default_currency = excluded.default_currency;

notify pgrst, 'reload schema';
