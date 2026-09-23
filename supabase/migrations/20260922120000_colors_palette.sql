-- The colour palette: an admin-curated list of shades, keyed by name (#83).
--
-- `variants.color` was free text, and the storefront swatch was a hardcoded
-- five-entry map in components/ProductDetail.tsx. A colour the client typed
-- that was not in that map rendered a grey dot with no explanation -- the
-- vocabulary of displayable colours lived in a .tsx file they cannot reach.
-- Same shape of problem as lib/taxonomy.ts, and #49 is the general fix.
--
-- Keyed on the NAME rather than a new uuid, deliberately. `variants.color`
-- stays the text column it already is, so the reservation hold, the Stripe
-- line items, complete_checkout and every Order row are untouched by this
-- migration. A uuid key would have rewritten the money path to change a
-- swatch.
--
-- The alternative -- a hex column on `variants` -- is wrong for a reason worth
-- recording: a colour spans sizes, so S/M/L/XL of Espresso are four rows, and
-- four independently-editable hexes disagree the moment one is edited.

create table if not exists public.colors (
  name text primary key,
  hex  text not null check (hex ~ '^#[0-9a-fA-F]{6}$')
);

comment on table public.colors is
  'The shades the shop sells, curated by the admin (#83). Referenced by variants.color ON UPDATE CASCADE, so renaming one here carries every Variant with it. hex is the swatch the storefront renders.';

-- "Sage" and "sage" as two palette entries is precisely the near-duplicate
-- this table exists to prevent, and a text primary key alone would allow it.
create unique index if not exists colors_name_lower_key
  on public.colors (lower(name));

-- ---------------------------------------------------------------------------
-- Seed, BEFORE the foreign key -- otherwise the constraint fails on the data
-- that is already here.
-- ---------------------------------------------------------------------------
--
-- The five hexes the storefront map already used, so nothing changes visually:
-- three are the Tailwind theme tokens from app/globals.css, one was a literal
-- in the map, and everything else in the catalog gets the same #D1D5DB that
-- `bg-gray-300` was rendering as the fallback. A colour that looked grey
-- before still looks grey, and now appears in the palette for the client to
-- correct.

insert into public.colors (name, hex) values
  ('Espresso', '#502D1E'),  -- --color-ssuni-brown
  ('Bone',     '#D9D3C7'),  -- the map's own literal
  ('Natural',  '#E6E0D2'),  -- --color-ssuni-light2
  ('Sage',     '#8C947D'),  -- --color-ssuni-sage
  ('Slate',    '#72858A')   -- --color-ssuni-slate
on conflict (name) do nothing;

insert into public.colors (name, hex)
select distinct v.color, '#D1D5DB'
from public.variants v
where not exists (
  select 1 from public.colors c where lower(c.name) = lower(v.color)
);

-- Fold any case-only spelling onto the palette's canonical name. Without this
-- a Variant reading "sage" is skipped by the insert above (the palette already
-- holds "Sage", and the unique index is on lower(name)) and then fails the
-- foreign key, which matches on the exact string. A Product holding both
-- "Sage"/M and "sage"/M would collide with variants_product_id_color_size_key
-- here and fail the migration loudly, which is the right outcome -- it is two
-- rows for one physical Variant.
update public.variants v
set color = c.name
from public.colors c
where lower(c.name) = lower(v.color) and v.color <> c.name;

-- ---------------------------------------------------------------------------
-- RLS. Part of this migration, not a follow-up (ADR 0004).
-- ---------------------------------------------------------------------------

alter table public.colors enable row level security;

-- The palette is public: the storefront renders these hexes on every product
-- page, and a shade's name is not a secret.
drop policy if exists colors_select_all on public.colors;
create policy colors_select_all on public.colors
  for select to anon, authenticated
  using (true);

drop policy if exists colors_admin_write on public.colors;
create policy colors_admin_write on public.colors
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- Necessary in addition to the policies: Supabase does not auto-expose new
-- tables to the Data API roles, so RLS alone leaves this "permission denied".
grant select on public.colors to anon, authenticated;
grant insert, update, delete on public.colors to authenticated;

-- ---------------------------------------------------------------------------
-- The constraint. This is what makes the palette a palette.
-- ---------------------------------------------------------------------------
--
-- ON UPDATE CASCADE: renaming a colour is a one-field edit that carries every
-- Variant with it, including Variants that have sold -- a rename changes what
-- a shade is CALLED, not which shade was bought. The freeze in the next
-- migration (#84) exempts this cascade for exactly that reason.
--
-- ON DELETE RESTRICT: removing a colour still in use would otherwise take its
-- Variants with it, and unsold inventory would vanish silently. The Admin
-- Dashboard offers delete only at zero usage, so this is the backstop for a
-- direct POST rather than something the client is expected to meet.

alter table public.variants
  drop constraint if exists variants_color_fkey;

alter table public.variants
  add constraint variants_color_fkey
  foreign key (color) references public.colors (name)
  on update cascade on delete restrict;

-- The FK's referencing side has no index of its own. variants is small and
-- (product_id, color, size) is already unique, but a cascading rename and the
-- RESTRICT check both scan by colour, so give them one.
create index if not exists variants_color_idx on public.variants (color);

-- ---------------------------------------------------------------------------
-- The view has to carry the hex itself.
-- ---------------------------------------------------------------------------
--
-- PostgREST cannot follow a foreign key through a view, so `colors` will not
-- embed under `variants_available` the way `variants_available` embeds under
-- `products`. The hex comes down the existing round trip as a column instead.
--
-- LEFT JOIN, not an inner one: an inner join would make a Variant disappear
-- from the view if its colour row ever went missing, turning a grey swatch
-- into an unsellable Product. The foreign key above should make that
-- impossible; the join type is what keeps the failure mode harmless if it is
-- not.
--
-- Dropped and recreated rather than CREATE OR REPLACE because the column list
-- changes. That loses the grant and the comment, so both are re-issued below.

drop view if exists public.variants_available;

create view public.variants_available
with (security_invoker = on) as
  select
    v.id,
    v.product_id,
    v.color,
    c.hex as color_hex,
    v.size,
    v.stock,
    private.variant_available_stock(v.id) as available_stock
  from public.variants v
  left join public.colors c on c.name = v.color;

comment on view public.variants_available is
  'Available Stock per CONTEXT.md: stock minus unexpired held Reservations. Every storefront surface that displays stock must read this, not variants.stock -- the client sees the raw count in Studio for restocking, which is deliberately a different number. security_invoker means Hidden Products are filtered by the variants RLS policy rather than by this view. color_hex is joined from public.colors (#83) because PostgREST cannot embed a foreign key through a view.';

grant select on public.variants_available to anon, authenticated;
