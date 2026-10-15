-- =============================================================================
-- Partners: the three people whose money the workspace tracks.
--
-- Swornim, Pragyan and Sushant are partners. Sign-in accounts (Administrator
-- and the personal Gmail logins) stay in the database — every expense they
-- recorded, paid or were split into keeps its history — but they are no longer
-- shown in rankings, investment totals per person, or payer / split pickers.
--
-- Today the partners are exactly the participants without a login, so that is
-- the starting value. It is a plain flag from here on: Settings → Team changes
-- it, and setting a password later does not hide a partner.
--
-- Nothing about amounts, shares or payers changes.
--
-- Safe to run more than once.
-- =============================================================================

alter table public.users add column if not exists is_partner boolean;

update public.users
   set is_partner = (password_hash is null)
 where is_partner is null;

alter table public.users alter column is_partner set default true;
alter table public.users alter column is_partner set not null;
