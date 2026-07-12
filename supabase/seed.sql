-- =============================================================================
-- Avernek seed data — categories, vendors, and participants.
-- =============================================================================

-- Categories (navy family + amber for the "urgency" ones)
insert into public.categories (name, color) values
  ('Software / SaaS',    '#1e3a5f'),
  ('AI / Token Usage',   '#2563eb'),
  ('Ad Spend',           '#7c3aed'),
  ('Travel',             '#0891b2'),
  ('Office Supplies',    '#64748b'),
  ('Phone / Recharge',   '#0f766e'),
  ('Client-specific',    '#0d9488'),
  ('Miscellaneous',      '#94a3b8')
on conflict (name) do nothing;

-- Vendors (real Avernek recurring vendors; USD ones flagged)
insert into public.vendors (name, category_id, default_currency)
select v.name, c.id, v.cur
from (values
  ('n8n',              'Software / SaaS',  'USD'),
  ('OpenAI',           'AI / Token Usage', 'USD'),
  ('Anthropic',        'AI / Token Usage', 'USD'),
  ('Vercel',           'Software / SaaS',  'USD'),
  ('Domain Registrar', 'Software / SaaS',  'USD'),
  ('Google Drive',     'Software / SaaS',  'USD'),
  ('CapCut',           'Software / SaaS',  'USD'),
  ('Meta Ads',         'Ad Spend',         'USD'),
  ('Petrol',           'Travel',           'NPR'),
  ('Ride fare',        'Travel',           'NPR'),
  ('Stationery',       'Office Supplies',  'NPR'),
  ('Mobile Recharge',  'Phone / Recharge', 'NPR')
) as v(name, cat, cur)
join public.categories c on c.name = v.cat
on conflict (name) do nothing;

-- These people can be selected in expenses without having login accounts.
insert into public.users (id, name, email, is_core_member)
select '00000000-0000-4000-8000-000000000102', 'Pragyan', 'pragyan@local.expense', true
where not exists (select 1 from public.users where lower(name) like 'pragyan%');

insert into public.users (id, name, email, is_core_member)
select '00000000-0000-4000-8000-000000000103', 'Sushant', 'sushant@local.expense', true
where not exists (select 1 from public.users where lower(name) like 'sushant%');

update public.users set is_core_member = true
where lower(name) like 'swornim%' or lower(name) like 'pragyan%' or lower(name) like 'sushant%';
