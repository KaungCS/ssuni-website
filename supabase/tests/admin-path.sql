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

-- 7. Orders: a customer reads their own and nobody else's (#17).
--
--    The subject is an admin by this point, and orders_admin_all would satisfy
--    every read below on its own -- masking a broken orders_select_own with a
--    row of green. So drop the allowlist entry first and check the customer
--    path as a plain customer. (Still inside the transaction; still rolled
--    back.) The admin checks re-add it at the end.
reset role;
delete from public.admins where user_id = (select id from subject);

insert into public.orders (user_id, stripe_session_id, total)
select id, 'cs_test_admin_path', 65.00 from subject;

insert into public.order_items (order_id, variant_id, quantity, unit_price)
select o.id, v.id, 1, 65.00
from public.orders o
cross join (select id from public.variants order by id limit 1) v
where o.stripe_session_id = 'cs_test_admin_path';

select pg_temp.become_subject();
set local role authenticated;

insert into results select 11, 'customer_sees_own_order',
  exists (select 1 from public.orders where stripe_session_id = 'cs_test_admin_path'), true;

-- order_items has no user_id of its own; it inherits visibility through the
-- exists() on orders. This is the check that the inheritance actually works.
insert into results select 12, 'customer_sees_own_order_items',
  exists (
    select 1 from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.stripe_session_id = 'cs_test_admin_path'
  ), true;

-- The #17 done-when, from the direction that matters most: the customer who
-- owns the Order still cannot tell the shop it has shipped.
with attempt as (
  update public.orders set status = 'Shipped'
  where stripe_session_id = 'cs_test_admin_path'
  returning 1
)
insert into results select 13, 'owner_cannot_update_own_order_status',
  (select count(*) from attempt) = 0, true;

-- 8. Another customer sees nothing. Impersonating a uuid with no auth.users row
--    is deliberate: RLS evaluates auth.uid() either way, and it means this
--    check needs no second real account to exist in the project.
reset role;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000000000000', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

insert into results select 14, 'other_customer_cannot_see_order',
  not exists (select 1 from public.orders where stripe_session_id = 'cs_test_admin_path'), true;

insert into results select 15, 'other_customer_cannot_see_order_items',
  not exists (
    select 1 from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.stripe_session_id = 'cs_test_admin_path'
  ), true;

-- 9. Orders are created by the webhook (#18) and by nothing else. Checked as
--    grants rather than attempted writes, because a missing grant is refused
--    before any policy runs -- and an INSERT here would abort the transaction
--    rather than record a FAIL.
reset role;
insert into results select 16, 'orders_insert_denied_to_authenticated',
  not has_table_privilege('authenticated', 'public.orders', 'insert'), true;
insert into results select 17, 'orders_delete_denied_to_authenticated',
  not has_table_privilege('authenticated', 'public.orders', 'delete'), true;
insert into results select 18, 'orders_denied_to_anon',
  not has_table_privilege('anon', 'public.orders', 'select'), true;
insert into results select 19, 'order_items_denied_to_anon',
  not has_table_privilege('anon', 'public.order_items', 'select'), true;

-- 10. The admin's fulfilment path (#21): see every Order, and be the only
--     browser client that can move one to Shipped.
insert into public.admins (user_id) select id from subject;

select pg_temp.become_subject();
set local role authenticated;

insert into results select 20, 'admin_sees_order',
  exists (select 1 from public.orders where stripe_session_id = 'cs_test_admin_path'), true;

with attempt as (
  update public.orders set status = 'Shipped', tracking_link = 'https://example.com/track/1'
  where stripe_session_id = 'cs_test_admin_path'
  returning 1
)
insert into results select 21, 'admin_can_mark_shipped',
  (select count(*) from attempt) = 1, true;

-- 11. complete_checkout: the webhook's one transaction (#18, ADR 0010).
--
--     Here rather than in a vitest file because the property under test is
--     idempotency across a retry, which is a unique index and a transaction
--     boundary -- neither of which a mocked client can tell you anything about.
--     Here rather than in rls.mjs because it needs a real auth.users id
--     (orders.user_id is NOT NULL REFERENCES auth.users) and a rollback, and
--     this file already has both.
reset role;

-- A Variant of its own with a stock count this suite sets, so the arithmetic
-- below does not depend on what the client last typed into Supabase Studio.
create temp table wh as
  select id as variant_id from public.variants order by id limit 1;
update public.variants set stock = 10 where id = (select variant_id from wh);

-- What #15 would have left behind: one held Reservation per line, carrying the
-- price the line was quoted to Stripe at.
insert into public.reservations
  (variant_id, quantity, unit_price, stripe_session_id, expires_at)
select variant_id, 2, 19.99, 'cs_test_webhook', now() + interval '30 minutes' from wh;

create temp table wh_first as
  select public.complete_checkout(
    'cs_test_webhook', (select id from subject), 39.98) as order_id;

insert into results select 22, 'webhook_creates_the_order',
  (select order_id from wh_first) is not null, true;

-- unit_price = 19.99, not whatever products.price says today. This is the check
-- that the price came from the Reservation rather than a live re-read.
insert into results select 23, 'order_item_carries_the_price_it_was_held_at',
  exists (
    select 1 from public.order_items
    where order_id = (select order_id from wh_first)
      and variant_id = (select variant_id from wh)
      and quantity = 2 and unit_price = 19.99
  ), true;

insert into results select 24, 'stock_falls_by_the_purchased_quantity',
  (select stock from public.variants where id = (select variant_id from wh)) = 8, true;

insert into results select 25, 'reservation_consumed',
  (select status from public.reservations where stripe_session_id = 'cs_test_webhook')
    = 'consumed', true;

-- The retry. Stripe redelivers until it gets a 2xx, so this is the ordinary
-- case rather than an edge one, and every assertion below must hold.
create temp table wh_replay as
  select public.complete_checkout(
    'cs_test_webhook', (select id from subject), 39.98) as order_id;

insert into results select 26, 'a_replayed_event_reports_nothing_to_do',
  (select order_id from wh_replay) is null, true;

insert into results select 27, 'a_replayed_event_creates_no_second_order',
  (select count(*) from public.orders where stripe_session_id = 'cs_test_webhook') = 1, true;

insert into results select 28, 'a_replayed_event_does_not_decrement_stock_twice',
  (select stock from public.variants where id = (select variant_id from wh)) = 8, true;

insert into results select 29, 'a_replayed_event_adds_no_second_order_item',
  (select count(*) from public.order_items
   where order_id = (select order_id from wh_first)) = 1, true;

-- Checked as a grant rather than an attempted call: a refused EXECUTE aborts
-- the transaction, taking every result above with it.
insert into results select 30, 'complete_checkout_denied_to_authenticated',
  not has_function_privilege(
    'authenticated', 'public.complete_checkout(text, uuid, numeric)', 'execute'), true;

insert into results select 31, 'complete_checkout_denied_to_anon',
  not has_function_privilege(
    'anon', 'public.complete_checkout(text, uuid, numeric)', 'execute'), true;

reset role;

select seq, check_name,
       case when result = expected then 'PASS' else 'FAIL' end as outcome,
       result, expected
from results order by seq;

rollback;
