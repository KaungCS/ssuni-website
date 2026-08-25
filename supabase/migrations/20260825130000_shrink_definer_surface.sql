-- Shrink the SECURITY DEFINER surface flagged by `supabase db advisors`.
--
-- The previous migration got the behaviour right and the structure wrong. It
-- made the whole variants_available view SECURITY DEFINER so it could read
-- reservations, which Supabase's linter reports as an ERROR (0010), and which
-- forced the view to re-implement the Hidden-product rule in a join because a
-- definer view sits outside the variants RLS policy. Two copies of one rule.
--
-- The fix keeps the property that actually matters -- an anonymous shopper must
-- see stock reduced by Reservations they cannot themselves read -- while making
-- the definer surface as small as it can be:
--
--   * private.variant_available_stock(uuid) is the only definer object. It
--     reads reservations and returns a single integer. Nothing else.
--   * variants_available becomes security_invoker, so its read of variants goes
--     through variants_select_visible like any other query. The Hidden rule now
--     lives in exactly one place -- the policy -- instead of being duplicated.
--   * Both helper functions move to a `private` schema, which PostgREST does not
--     expose, so neither is reachable at /rest/v1/rpc/. That is the documented
--     remediation for linter 0028/0029.
--
-- Verified by the same checks as the previous migration: Available Stock must
-- still drop while a Reservation is held, recover when it lapses, and a Hidden
-- Product's Variants must still disappear from the view.

create schema if not exists private;

comment on schema private is
  'Helper functions that policies and views call but the REST API must not expose. Not listed in PostgREST db-schemas, so nothing here is reachable at /rest/v1/rpc/.';

-- USAGE only: callers need it to invoke the functions below from policy
-- expressions and from the view. It grants no access to anything else, and the
-- schema is not exposed by the API regardless.
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------------
-- is_admin() moves out of the exposed schema.
-- ---------------------------------------------------------------------------
-- ALTER ... SET SCHEMA rather than drop-and-recreate: the products and variants
-- policies reference this function by OID, so moving it leaves them intact.
-- Dropping it would require tearing down and rebuilding every policy that calls
-- it, which is exactly the kind of churn that loses a policy by accident.

alter function public.is_admin() set schema private;

-- EXECUTE stays granted: policy expressions are evaluated as the calling role,
-- so anon and authenticated must still be able to run it. It is simply no longer
-- addressable over REST.
grant execute on function private.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Available Stock: one small definer function instead of a definer view.
-- ---------------------------------------------------------------------------

create or replace function private.variant_available_stock(v_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    v.stock - coalesce((
      select sum(r.quantity)
      from public.reservations r
      where r.variant_id = v.id
        and r.status = 'held'
        -- Expiry is computed, not scheduled (ADR 0010): a lapsed Reservation
        -- stops holding stock without needing to be explicitly released, so a
        -- missed checkout.session.expired webhook cannot strand inventory.
        and r.expires_at > now()
    ), 0),
    0
  )::integer
  from public.variants v
  where v.id = v_id;
$$;

comment on function private.variant_available_stock(uuid) is
  'Available Stock for one Variant: stock minus unexpired held Reservations. SECURITY DEFINER because callers must never read public.reservations directly -- if this ran as the caller the subquery would match zero rows and report full stock as available, overselling the last unit.';

grant execute on function private.variant_available_stock(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The view, rebuilt as security_invoker.
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced because the security_invoker property and the
-- dropped join to products both change its definition shape.

drop view if exists public.variants_available;

create view public.variants_available
with (security_invoker = on) as
  select
    v.id,
    v.product_id,
    v.color,
    v.size,
    v.stock,
    private.variant_available_stock(v.id) as available_stock
  from public.variants v;

comment on view public.variants_available is
  'Available Stock per CONTEXT.md: stock minus unexpired held Reservations. Every storefront surface that displays stock must read this, not variants.stock -- the client sees the raw count in Studio for restocking, which is deliberately a different number. security_invoker means Hidden Products are filtered by the variants RLS policy rather than by this view.';

-- A definer function cannot be inlined, so this costs one call per row rather
-- than a single joined aggregate. At this catalog size that is irrelevant; if
-- the catalog grows into the thousands, revisit with a lateral join against a
-- definer view of reservation totals rather than by making this view definer.

grant select on public.variants_available to anon, authenticated;
