-- The webhook's write, as one transaction. Issue #18, per ADR 0010.
--
-- `checkout.session.completed` has to do four things together -- create the
-- Order, record its Order Items, consume the Reservations behind the Session,
-- and decrement variants.stock -- or none of them. supabase-js cannot open a
-- transaction, so this is a function for the same reason reserve_cart is: four
-- separate PostgREST calls can be interrupted after the second, leaving an
-- Order whose stock was never taken, or stock taken twice.
--
-- Idempotency is orders.stripe_session_id being UNIQUE, and nothing else.
-- Stripe retries until it gets a 2xx, so the second delivery must be a no-op
-- rather than a second Order. `on conflict do nothing returning id` turns that
-- into a fact the function can read -- no row back means somebody already did
-- all four things, in one transaction, so there is nothing left to check.

-- ---------------------------------------------------------------------------
-- What the line cost, frozen at Session creation
-- ---------------------------------------------------------------------------
--
-- order_items.unit_price is "the price charged" (#17), and the only moment the
-- shop knows that for certain is when it builds Stripe's price_data. Reading
-- products.price back in the webhook is *nearly* the same number and silently
-- is not: Stripe retries a failed delivery for up to three days, and the client
-- edits prices in Supabase Studio between sessions (#5). A retry landing after
-- an edit would record an Order at a price the customer was never charged --
-- discovered, if ever, during a refund dispute.
--
-- The Reservation is already the per-Session, per-Variant row, created in the
-- same call that prices the Stripe line. Carrying the price there costs one
-- column and leaves the webhook reading a single table.
alter table public.reservations
  add column if not exists unit_price numeric(10, 2) not null default 0
    check (unit_price >= 0);

-- The default exists only to fill the rows already in flight when this ran.
-- Dropped immediately so a future insert that forgets the price fails loudly
-- rather than recording a free garment.
alter table public.reservations alter column unit_price drop default;

comment on column public.reservations.unit_price is
  'The price this line was quoted to Stripe at, frozen at Session creation. Becomes order_items.unit_price in complete_checkout -- do not read products.price in the webhook instead, see the migration comment.';

-- ---------------------------------------------------------------------------
-- reserve_cart, unchanged except that it now carries the price
-- ---------------------------------------------------------------------------
--
-- Restated in full because `create or replace` takes a whole body. The only
-- difference from 20260913130000_reserve_cart.sql is the unit_price column in
-- the final INSERT; every comment there still applies and is not repeated here.
-- p_items entries are now {variant_id, quantity, unit_price}; an entry missing
-- unit_price violates the NOT NULL above rather than defaulting to zero.

create or replace function public.reserve_cart(
  p_session_id text,
  p_expires_at timestamptz,
  p_items      jsonb
)
returns table (variant_id uuid, requested integer, available integer)
language plpgsql
volatile
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  perform v.id
  from public.variants v
  where v.id in (
    select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i
  )
  order by v.id
  for update;

  return query
  with req as (
    select (i->>'variant_id')::uuid  as vid,
           (i->>'quantity')::integer as qty
    from jsonb_array_elements(p_items) i
  ),
  avail as (
    select
      r.vid,
      r.qty,
      case
        when v.id is null or p.is_hidden then 0
        else greatest(
          v.stock - coalesce((
            select sum(res.quantity)
            from public.reservations res
            where res.variant_id = r.vid
              and res.status = 'held'
              and res.expires_at > now()
          ), 0),
          0
        )
      end::integer as available
    from req r
    left join public.variants v on v.id = r.vid
    left join public.products p on p.id = v.product_id
  )
  select a.vid, a.qty, a.available
  from avail a
  where a.available < a.qty;

  if found then
    return;
  end if;

  insert into public.reservations
    (variant_id, quantity, unit_price, stripe_session_id, expires_at)
  select (i->>'variant_id')::uuid,
         (i->>'quantity')::integer,
         (i->>'unit_price')::numeric,
         p_session_id,
         p_expires_at
  from jsonb_array_elements(p_items) i
  on conflict (stripe_session_id, variant_id) do nothing;
end;
$$;

-- `create or replace` keeps the existing ACL, so this is belt-and-braces --
-- but the revoke is restated so the two migrations do not have to be read
-- together to know who may call this.
revoke execute on function public.reserve_cart(text, timestamptz, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- complete_checkout
-- ---------------------------------------------------------------------------

create or replace function public.complete_checkout(
  p_session_id text,
  p_user_id    uuid,
  p_total      numeric
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  -- The idempotency gate. Every write below happens in the same transaction as
  -- this insert, so "the Order already exists" is proof that all of them did.
  -- Under two concurrent deliveries the second blocks on the unique index until
  -- the first commits, then takes the conflict branch -- which is why this is
  -- the first statement rather than a preceding `select ... where exists`.
  insert into public.orders (user_id, stripe_session_id, total)
  values (p_user_id, p_session_id, p_total)
  on conflict (stripe_session_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    return null;
  end if;

  -- Locked in primary-key order, matching reserve_cart. A checkout holding two
  -- Variants and a webhook consuming the same two in the opposite order is a
  -- deadlock; one shared ordering removes it.
  perform v.id
  from public.variants v
  where v.id in (
    select r.variant_id from public.reservations r
    where r.stripe_session_id = p_session_id
  )
  order by v.id
  for update;

  -- Not filtered on status = 'held'. The shopper has paid, so what the
  -- Reservation currently says about itself is irrelevant: a hold that lapsed
  -- between payment and a retried delivery still describes what was bought, and
  -- skipping it would write an Order with missing lines and untaken stock.
  insert into public.order_items (order_id, variant_id, quantity, unit_price)
  select v_order_id, r.variant_id, r.quantity, r.unit_price
  from public.reservations r
  where r.stripe_session_id = p_session_id;

  -- greatest(..., 0) because variants.stock carries `check (stock >= 0)`. If
  -- availability was ever wrong and the shelf is short, the sale stands and the
  -- count floors at zero -- raising here would fail the webhook forever on an
  -- Order that has already been paid for, which is the worse of the two.
  update public.variants v
  set stock = greatest(v.stock - r.quantity, 0)
  from public.reservations r
  where r.stripe_session_id = p_session_id
    and v.id = r.variant_id;

  update public.reservations
  set status = 'consumed'
  where stripe_session_id = p_session_id;

  return v_order_id;
end;
$$;

comment on function public.complete_checkout(text, uuid, numeric) is
  'Turns one paid Checkout Session into an Order, its Order Items, consumed Reservations and a stock decrement, in one transaction (#18, ADR 0010). Returns the new Order id, or NULL if this Session was already recorded -- a replayed Stripe event. Callable only with the secret key.';

-- Same reasoning as reserve_cart: EXECUTE is granted to PUBLIC by default and
-- anon inherits it, so without `from public` this revoke does nothing. The
-- webhook calls this with SUPABASE_SECRET_KEY; no browser key may.
revoke execute on function public.complete_checkout(text, uuid, numeric)
  from public, anon, authenticated;
