-- Admin write path verification.
--   npx supabase db query --linked -f supabase/tests/admin-path.sql
--
-- The companion to supabase/tests/rls.mjs, which proves an anonymous shopper
-- cannot write. This proves the other half -- that an allowlisted admin CAN --
-- because a policy that denies everyone passes every "is it locked?" test while
-- leaving the client unable to edit their own catalog.
--
-- Impersonates roles with set_config on request.jwt.claims rather than needing a
-- real OTP login, and runs inside a transaction that ROLLS BACK: it grants no
-- admin rights and leaves no rows behind. Safe to run against production.
--
-- Uses the oldest auth.users row as the stand-in admin, so it needs no
-- hardcoded UUID.

begin;

create temp table results (seq int, check_name text, result boolean, expected boolean);
grant all on results to authenticated, anon;

create temp table subject as select id from auth.users order by created_at limit 1;
grant all on subject to authenticated, anon;

-- Helper: claim to be the subject user, as the authenticated role would be.
create or replace function pg_temp.become_subject() returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', (select id from subject), 'role', 'authenticated')::text,
    true
  );
end;
$$;

-- 1. Before any allowlist entry: not an admin, and writes are refused.
select pg_temp.become_subject();
set local role authenticated;

insert into results select 1, 'not_admin_before_allowlist', private.is_admin(), false;

with attempt as (
  update public.products set name = 'SHOULD NOT APPLY'
  where slug = 'rabbit-hole-hoodie'
  returning 1
)
insert into results select 2, 'non_admin_update_blocked', (select count(*) from attempt) = 0, true;

-- 2. Add the allowlist entry as the owner, then drop back down.
reset role;
insert into public.admins (user_id) select id from subject;

select pg_temp.become_subject();
set local role authenticated;

insert into results select 3, 'is_admin_after_allowlist', private.is_admin(), true;

-- 3. The same write must now succeed.
with attempt as (
  update public.products set name = 'Admin Edit Worked'
  where slug = 'rabbit-hole-hoodie'
  returning name
)
insert into results select 4, 'admin_update_allowed', (select count(*) from attempt) = 1, true;

-- 4. An admin must be able to add a Variant too.
with attempt as (
  insert into public.variants (product_id, color, size, stock)
  select id, 'Sage', 'XL', 3 from public.products where slug = 'rabbit-hole-hoodie'
  returning 1
)
insert into results select 5, 'admin_insert_variant_allowed', (select count(*) from attempt) = 1, true;

-- 5. An admin sees Hidden Products; an anonymous shopper does not.
reset role;
update public.products set is_hidden = true where slug = 'signature-canvas-tote';

-- Asserted on the Hidden Product itself rather than on a catalog count: the
-- client adds Products in Supabase Studio (#5), and a literal count makes this
-- suite fail the day they do. It did, on 2026-08-30, when a third Product
-- appeared.
select pg_temp.become_subject();
set local role authenticated;
insert into results select 6, 'admin_sees_hidden_products',
  exists (select 1 from public.products where slug = 'signature-canvas-tote'), true;

-- Clear the claim before dropping to anon. A real anonymous request carries no
-- `sub`; leaving the admin's claim set makes auth.uid() -- and so is_admin() --
-- still resolve to the admin, which is a property of this harness rather than of
-- any request the API can actually receive.
select set_config('request.jwt.claims', '', true);
set local role anon;
insert into results select 7, 'anon_does_not_see_hidden',
  not exists (select 1 from public.products where slug = 'signature-canvas-tote'), true;
insert into results select 8, 'anon_is_not_admin', private.is_admin() = false, true;

-- 6. Reservations stay off-limits even to an admin: they are server-only, not
--    admin-only (ADR 0010 -- only the checkout route may write them).
reset role;
insert into results select 9, 'reservations_denied_to_authenticated',
  not has_table_privilege('authenticated', 'public.reservations', 'select'), true;
insert into results select 10, 'reservations_denied_to_anon',
  not has_table_privilege('anon', 'public.reservations', 'select'), true;

select seq, check_name,
       case when result = expected then 'PASS' else 'FAIL' end as outcome,
       result, expected
from results order by seq;

rollback;
