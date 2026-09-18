-- Orders and Order Items. Issue #17, per ADR 0004 (RLS is the security
-- boundary) and ADR 0010 (the Reservation behind a Session becomes the Order).
--
-- Terminology follows CONTEXT.md: an Order is a completed purchase; its Order
-- Items are the Variants and quantities it contains, priced as they were at
-- purchase time rather than as they are priced today.
--
-- Nothing here is written by a browser. The Stripe webhook (#18) inserts both
-- tables with the secret key, which bypasses RLS -- so the policies below are
-- entirely about who may *read*, plus the admin's fulfilment writes (#21).

-- ---------------------------------------------------------------------------
-- Order Status
-- ---------------------------------------------------------------------------
--
-- The five values are the glossary's, spelled exactly as CONTEXT.md spells
-- them. An enum rather than a check constraint, matching reservation_status:
-- the set is a lifecycle that changes only by deliberate decision, and the
-- enum makes an invented status a type error rather than a row nobody notices.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum
      ('Paid', 'Shipped', 'Delivered', 'Cancelled', 'Refunded');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  -- not null: checkout requires a signed-in shopper (#16), so every Order has
  -- an owner from the first row. An Order nobody owns is unreadable by the
  -- customer under the policy below and invisible on /profile (#20) -- a
  -- nullable column here would make that failure silent instead of impossible.
  --
  -- on delete restrict, not cascade: deleting an account must not erase the
  -- record of a sale that really happened. If a shopper ever needs deleting,
  -- that is a decision about their Orders too, taken deliberately.
  user_id           uuid not null references auth.users (id) on delete restrict,
  -- The idempotency key for #18. Stripe retries checkout.session.completed
  -- until it gets a 2xx, so the webhook has to be able to ask "have I already
  -- made this Order?" and get an answer from the database rather than a guess.
  -- Unique is what makes a replayed event a conflict instead of a second Order.
  stripe_session_id text not null unique,
  status            public.order_status not null default 'Paid',
  tracking_link     text,
  -- What Stripe actually charged, not a sum of the lines. They agree today;
  -- once shipping or tax is added they will not, and the number that matters
  -- is the one on the customer's card. numeric(10,2) to match products.price
  -- (Stripe reports cents; the conversion happens once, in the webhook).
  total             numeric(10, 2) not null check (total >= 0),
  created_at        timestamptz not null default now()
);

-- /profile (#20) reads "my Orders, newest first"; /admin/orders (#21) reads the
-- same shape without the user filter.
create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Order Items
-- ---------------------------------------------------------------------------

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  -- on delete restrict, deliberately unlike every other reference to variants
  -- in this schema. The client deletes Variants in Supabase Studio; cascading
  -- would quietly shred the line items of Orders already shipped, and an Order
  -- whose contents have vanished cannot be fulfilled, refunded or disputed.
  -- The Hidden flag is how a Product leaves the storefront (CONTEXT.md);
  -- deleting one that has sold should fail loudly, and this is what fails it.
  variant_id uuid not null references public.variants (id) on delete restrict,
  quantity   integer not null check (quantity > 0),
  -- Captured at purchase time. The Cart never stores a price (ADR 0001) and
  -- the storefront always reads the live one -- but an Order is a record of
  -- what was charged, so this is the one place a price is frozen.
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- RLS. Part of this migration, not a follow-up (ADR 0004).
-- ---------------------------------------------------------------------------

alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- A customer reads their own Orders and nobody else's. `to authenticated`
-- alone, with no anon clause: an Order is never public, so an anonymous caller
-- has no policy to satisfy and reads nothing at all.
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()));

-- The admin's fulfilment path: read every Order, set status and tracking_link
-- (#21). `for all` rather than a separate select and update policy -- one
-- policy, the same shape as products_admin_write.
--
-- Note this does NOT let an admin insert an Order: no insert grant is issued
-- below, and the grant is checked before any policy. Orders come from the
-- webhook or they do not exist.
drop policy if exists orders_admin_all on public.orders;
create policy orders_admin_all on public.orders
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- Order Items are visible exactly when their Order is. The subquery is itself
-- subject to the two policies above, so "mine" and "admin sees everything" are
-- defined once and inherited -- the same trick variants_select_visible uses.
drop policy if exists order_items_select_visible on public.order_items;
create policy order_items_select_visible on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o where o.id = order_items.order_id
  ));

-- ---------------------------------------------------------------------------
-- Grants. Required in addition to the policies, and in this order.
-- ---------------------------------------------------------------------------
--
-- Revoke first. Supabase ships default privileges that grant ALL on new tables
-- in `public` to anon and authenticated, so these tables are created writable
-- and a bare `grant select` would be additive rather than definitive -- leaving
-- INSERT and DELETE in place under the admin policy, which is a browser able to
-- fabricate a Paid Order. supabase/tests/admin-path.sql asserts the absence of
-- both; it caught exactly that on the first run of this migration.
revoke all on public.orders      from anon, authenticated;
revoke all on public.order_items from anon, authenticated;

-- Reads only, and only for a signed-in caller. RLS then decides *which* rows:
-- their own, or every row if they are the admin.
grant select on public.orders      to authenticated;
grant select on public.order_items to authenticated;

-- The one browser write on either table: the admin marking an Order fulfilled
-- (#21), gated by orders_admin_all. Column-scoped, so even an admin cannot move
-- an Order to another customer or rewrite what they were charged.
grant update (status, tracking_link) on public.orders to authenticated;

-- Nothing is granted INSERT or DELETE, deliberately. An Order is created by the
-- Stripe webhook (#18) with SUPABASE_SECRET_KEY, which bypasses RLS and needs
-- no grant here, or it does not exist.

comment on table public.orders is
  'A completed purchase (CONTEXT.md). Written only by the Stripe webhook (#18) with the secret key; stripe_session_id is unique so a retried event cannot create a second Order.';

comment on table public.order_items is
  'The Variants and quantities in one Order, at the price charged. variant_id is ON DELETE RESTRICT so deleting a sold Variant fails rather than erasing order history.';
