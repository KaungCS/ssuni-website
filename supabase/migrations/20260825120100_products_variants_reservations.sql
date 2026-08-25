-- Catalog schema v1: Products, Variants, Reservations, and the Available Stock
-- read path. Per ADR 0002 (products in Supabase), ADR 0004 (RLS is the security
-- boundary) and ADR 0010 (reserve stock at checkout). Issue #3.
--
-- Terminology follows CONTEXT.md: a Product is sold as one or more Variants; a
-- Reservation is a temporary hold on a Variant; Available Stock is stock minus
-- unexpired Reservations, and is what the storefront must display.

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  -- Decimal rather than integer cents: the client edits Products directly in
  -- Supabase Studio until the Admin Dashboard ships (ADR 0007), and 65.00 is
  -- what they will type. Conversion to Stripe's minor units happens once, at
  -- the checkout boundary in #15: Math.round(price * 100).
  price       numeric(10, 2) not null check (price >= 0),
  image_url   text,
  is_new      boolean not null default false,
  -- "Hidden" per CONTEXT.md: excluded from customer-facing pages without
  -- deleting the record. The Archive is the set of these.
  is_hidden   boolean not null default false,
  -- Taxonomy. Values are slugs matching exactly what components/ShopDropdown.tsx
  -- already emits (?department=unisex, ?category=hoodies, ?collection=...), so
  -- #10 can filter without a translation layer. Display labels live in
  -- lib/taxonomy.ts.
  department  text,
  category    text,
  -- text[] rather than the single column issue #3 specified: a Product can sit
  -- on "Best Sellers" and "Fall Lookbook" at once, and discovering that in
  -- week 2 would mean a data migration mid-schedule.
  collections text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists products_collections_idx on public.products using gin (collections);
create index if not exists products_department_idx  on public.products (department);
create index if not exists products_category_idx    on public.products (category);

-- ---------------------------------------------------------------------------
-- Variants
-- ---------------------------------------------------------------------------

create table if not exists public.variants (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  color      text not null,
  size       text not null,
  -- The physical count on the shelf. NOT what the storefront shows -- see
  -- public.variants_available below.
  stock      integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  unique (product_id, color, size)
);

create index if not exists variants_product_id_idx on public.variants (product_id);

-- ---------------------------------------------------------------------------
-- Reservations (ADR 0010)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reservation_status') then
    create type public.reservation_status as enum ('held', 'consumed', 'released');
  end if;
end
$$;

create table if not exists public.reservations (
  id                uuid primary key default gen_random_uuid(),
  variant_id        uuid not null references public.variants (id) on delete cascade,
  quantity          integer not null check (quantity > 0),
  stripe_session_id text not null,
  expires_at        timestamptz not null,
  status            public.reservation_status not null default 'held',
  created_at        timestamptz not null default now()
);

-- Partial index matching the Available Stock subquery below.
create index if not exists reservations_held_variant_idx
  on public.reservations (variant_id)
  where status = 'held';

-- One Reservation per (session, variant). Stripe retries webhooks, and #18 has
-- to consume the Reservation and decrement stock idempotently; this constraint
-- is the thing that makes "already handled" detectable rather than guessed.
create unique index if not exists reservations_session_variant_idx
  on public.reservations (stripe_session_id, variant_id);

-- ---------------------------------------------------------------------------
-- Available Stock
-- ---------------------------------------------------------------------------
--
-- READ THIS BEFORE CHANGING THE VIEW. The instinctive hardening move here is
-- `security_invoker = on`, and it is wrong in a way that loses money quietly.
--
-- The subquery reads public.reservations, which anon must never read. Under
-- invoker rights that subquery returns zero rows for an anonymous shopper
-- instead of raising -- so the view reports the FULL stock count as available
-- and the storefront happily sells the last unit twice, which is the exact
-- failure ADR 0010 exists to prevent.
--
-- So the view keeps definer rights (the Postgres default). It runs as its owner,
-- postgres, who also owns reservations and is therefore exempt from its RLS.
-- Do not add FORCE ROW LEVEL SECURITY to reservations without revisiting this.
--
-- Consequence: the view is NOT covered by the variants select policy, so it has
-- to enforce the Hidden rule itself -- hence the join to products below. Issue
-- #24's RLS audit re-reads this.

create or replace view public.variants_available as
  select
    v.id,
    v.product_id,
    v.color,
    v.size,
    v.stock,
    greatest(
      v.stock - coalesce((
        select sum(r.quantity)
        from public.reservations r
        where r.variant_id = v.id
          and r.status = 'held'
          -- Expiry is computed, not scheduled (ADR 0010): a Reservation that is
          -- never explicitly released stops holding stock the moment it lapses,
          -- so a missed checkout.session.expired webhook cannot strand inventory.
          and r.expires_at > now()
      ), 0),
      0
    )::integer as available_stock
  from public.variants v
  join public.products p on p.id = v.product_id
  where not p.is_hidden;

comment on view public.variants_available is
  'Available Stock per CONTEXT.md: stock minus unexpired held Reservations. Every storefront surface that displays stock must read this, not variants.stock. Runs with definer rights on purpose -- see the comment block in the migration.';

-- ---------------------------------------------------------------------------
-- RLS. Part of this migration, not a follow-up hardening task (ADR 0004).
-- ---------------------------------------------------------------------------

alter table public.products     enable row level security;
alter table public.variants     enable row level security;
alter table public.reservations enable row level security;

-- Products: anyone reads what is not Hidden; admins read everything and are the
-- only writers.
drop policy if exists products_select_visible on public.products;
create policy products_select_visible on public.products
  for select to anon, authenticated
  using (not is_hidden or public.is_admin());

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Variants: visible exactly when their parent Product is. The subquery is itself
-- subject to the products policy above, which gives the right answer either way.
drop policy if exists variants_select_visible on public.variants;
create policy variants_select_visible on public.variants
  for select to anon, authenticated
  using (exists (
    select 1 from public.products p
    where p.id = variants.product_id
  ));

drop policy if exists variants_admin_write on public.variants;
create policy variants_admin_write on public.variants
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Reservations: RLS enabled and deliberately NO policies. Written only by the
-- server with the service role (#15, #18). If a browser client could insert one,
-- a shopper could hold the entire catalog hostage.

-- ---------------------------------------------------------------------------
-- Grants. Necessary in addition to the policies above: current Supabase projects
-- do not auto-expose newly created tables to the Data API roles, so RLS alone
-- would leave every one of these returning "permission denied".
-- ---------------------------------------------------------------------------

grant select on public.products           to anon, authenticated;
grant select on public.variants           to anon, authenticated;
grant select on public.variants_available to anon, authenticated;

-- Gated entirely by the admin policies above; without is_admin() every one of
-- these is denied at the RLS layer.
grant insert, update, delete on public.products to authenticated;
grant insert, update, delete on public.variants to authenticated;

revoke all on public.reservations from anon, authenticated;
