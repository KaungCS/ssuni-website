-- A Variant that has been ordered keeps the colour and size it was sold as (#84).
--
-- lib/orders.ts renders an Order's lines through
-- `order_items ( quantity, unit_price, variants ( color, size, ... ) )`.
-- unit_price is frozen on order_items at purchase time, deliberately -- the
-- Stripe webhook takes it from reservations.unit_price precisely so a later
-- price edit cannot reach a receipt. Colour and size got no such treatment:
-- they are joined live off the Variant row, so editing variants.color rewrote
-- what every past Order said was bought, on the shopper's own order page and
-- on /admin/orders, with nothing recording that it happened.
--
-- The schema already takes this position about deletion one table over --
-- order_items.variant_id is ON DELETE RESTRICT so "an Order whose contents
-- have vanished cannot be fulfilled, refunded or disputed". An Order whose
-- contents silently CHANGED is the same problem wearing a better disguise.
--
-- In the database rather than in saveVariant() because the client also edits
-- Variants directly in Supabase Studio, where an application-layer check is
-- not in the request path at all. This covers Studio, the Server Action, and
-- anything added later, in one object.

create or replace function private.freeze_sold_variant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Cheap path first: stock changes constantly (restocking, and the stock
  -- decrement inside complete_checkout) and must stay free.
  if new.color is not distinct from old.color
     and new.size is not distinct from old.size then
    return new;
  end if;

  -- A palette rename (#83) arrives here as a foreign key cascade from
  -- public.colors. A referential action runs as an internal trigger, so
  -- pg_trigger_depth() is greater than 1 for the cascade and exactly 1 for an
  -- UPDATE the client issues. A rename changes what a shade is CALLED, not
  -- which shade was bought, so it is allowed through -- and it MUST be, or a
  -- colour's spelling becomes permanent the moment it sells once.
  --
  -- Narrowed to renames: a nested statement that also changes the size is not
  -- a cascade from colors and stays refused.
  if pg_trigger_depth() > 1 and new.size is not distinct from old.size then
    return new;
  end if;

  -- SECURITY DEFINER so this answer does not depend on the actor's RLS view of
  -- order_items. It would be correct today either way -- orders_admin_all lets
  -- the only human writer see every Order -- but a data-integrity guard that
  -- silently weakens when an unrelated policy changes is not a guard.
  if exists (select 1 from public.order_items oi where oi.variant_id = old.id) then
    raise exception 'variant_sold_frozen'
      using hint = 'This Variant has been ordered. Its colour and size are what the receipt says was bought; stock can still be changed.';
  end if;

  return new;
end;
$$;

comment on function private.freeze_sold_variant() is
  'Refuses a colour or size change on a Variant that appears in order_items (#84), so a past Order cannot be silently rewritten. Exempts the ON UPDATE CASCADE from public.colors, which is a rename of the same shade.';

drop trigger if exists freeze_sold_variant on public.variants;
create trigger freeze_sold_variant
  before update on public.variants
  for each row
  execute function private.freeze_sold_variant();
