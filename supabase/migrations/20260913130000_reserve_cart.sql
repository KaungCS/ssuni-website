-- Atomic check-and-hold for checkout. Issue #15, ADR 0010.
--
-- Reading Available Stock in TypeScript and then inserting a Reservation
-- narrows the oversell race without closing it. The check and the insert have
-- to happen under one lock, which is what this function is for.
--
-- SECURITY INVOKER, deliberately. 20260825130000_shrink_definer_surface.sql cut
-- the definer surface down to a single function in the unexposed `private`
-- schema, because Supabase's linter flags definer objects reachable over REST.
-- This function does not need definer rights: the route calls it with
-- SUPABASE_SECRET_KEY, which bypasses RLS, and public.reservations has RLS on
-- with deliberately no policies, so the same call from a browser key inserts
-- nothing. The revokes below make that belt-and-braces.

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
-- Resolve any name that is both a column and a plpgsql variable in favour of
-- the column. Without this the function raises 42702, "column reference
-- variant_id is ambiguous", on the INSERT below: plpgsql substitutes into the
-- ON CONFLICT target list, and `variant_id` is also an OUT parameter of the
-- RETURNS TABLE above. Every other reference in this function is already
-- table-qualified, and the p_ parameters name no column in any FROM here, so
-- this changes nothing else.
#variable_conflict use_column
begin
  -- Lock every requested Variant row, in primary-key order.
  --
  -- The ordering is load-bearing. Two Carts sharing two Variants and locking
  -- them in opposite orders deadlock; ordering by id gives every caller the
  -- same sequence. The Variant row is also the serialization point for the
  -- whole operation -- Reservations are separate rows, so two shoppers racing
  -- the last unit only serialize because both take this lock.
  perform v.id
  from public.variants v
  where v.id in (
    select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i
  )
  order by v.id
  for update;

  -- With the locks held, compute Available Stock and report every short line.
  --
  -- Availability is computed inline rather than through
  -- private.variant_available_stock, which is STABLE and may reuse a snapshot
  -- taken before the lock was acquired -- handing the second shopper stale
  -- availability and overselling the exact unit this exists to protect.
  --
  -- left join, so a variant_id matching nothing reports available 0 and is a
  -- shortfall rather than vanishing from both the check and the insert.
  --
  -- The products join makes a Hidden Product unavailable. The route's price
  -- re-read goes through RLS and would already have dropped it, but this
  -- function runs under a key that bypasses RLS, so without this it would hold
  -- stock for a Product the client has hidden.
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

  -- RETURN QUERY sets FOUND. Anything short means we have already returned the
  -- shortfalls and insert nothing: the Session carries every line, so a Cart we
  -- can only half-fill must fail whole.
  if found then
    return;
  end if;

  insert into public.reservations (variant_id, quantity, stripe_session_id, expires_at)
  select (i->>'variant_id')::uuid, (i->>'quantity')::integer, p_session_id, p_expires_at
  from jsonb_array_elements(p_items) i
  on conflict (stripe_session_id, variant_id) do nothing;
end;
$$;

comment on function public.reserve_cart(text, timestamptz, jsonb) is
  'Atomic check-and-hold for one Cart (ADR 0010). Returns one row per line that cannot be filled; an empty result means every Reservation was inserted. Callable only with the secret key -- see the revokes below.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and anon
-- inherits from PUBLIC. Without `from public` this revoke is cosmetic.
revoke execute on function public.reserve_cart(text, timestamptz, jsonb)
  from public, anon, authenticated;
