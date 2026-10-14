-- Salary and food expense categories, and clearer names for the AI vendors.
-- Safe to run more than once.

insert into public.categories (name, color)
values
  ('Salary', '#b45309'),
  ('Food',   '#c2410c')
on conflict (name) do nothing;

insert into public.vendors (name, category_id, default_currency)
select vendor.name, category.id, 'NPR'
from (values
  ('Staff Salary',  'Salary'),
  ('Food & Snacks', 'Food')
) as vendor(name, category)
join public.categories category on category.name = vendor.category
on conflict (name) do update
set category_id = excluded.category_id,
    default_currency = excluded.default_currency;

-- Rename in place so every existing expense and subscription keeps pointing at
-- the same vendor row. Skipped if the new name already exists.
update public.vendors set name = 'OpenAI (GPT)'
 where name = 'OpenAI'
   and not exists (select 1 from public.vendors where name = 'OpenAI (GPT)');

update public.vendors set name = 'Anthropic (Claude)'
 where name = 'Anthropic'
   and not exists (select 1 from public.vendors where name = 'Anthropic (Claude)');

insert into public.vendors (name, category_id, default_currency)
select vendor.name, category.id, 'USD'
from (values ('OpenAI (GPT)'), ('Anthropic (Claude)')) as vendor(name)
join public.categories category on category.name = 'AI / Token Usage'
on conflict (name) do nothing;
