-- Taxonomy terms are a declared list, not free text. Issue #10, ADR 0011.
--
-- The storefront 404s on a `?category=` slug it does not recognise, where
-- "recognise" means "present in lib/taxonomy.ts". That makes free text in these
-- columns dangerous in a way it was not before: the client edits Products by
-- hand in Supabase Studio until the Admin Dashboard ships (ADR 0007), and a
-- typo -- `hoodiez` for `hoodies` -- produces a real Product that renders
-- nowhere and raises no error anywhere. Silent invisibility is the worst
-- failure mode available here.
--
-- These CHECK constraints are deliberately the cheap half of the fix. The real
-- shape is `departments` / `categories` / `collections` tables with foreign
-- keys, which is what the Admin Dashboard's category editor will edit; that is
-- issue #38, scheduled next. Until then the cost is real and worth naming:
-- adding a category needs a migration, so the client cannot do it alone.
--
-- The value lists below are generated from lib/taxonomy.ts and must be changed
-- with it. That coupling is exactly what #38 removes.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_department_declared'
  ) then
    alter table public.products
      add constraint products_department_declared
      check (department is null or department in ('women', 'men', 'unisex'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'products_category_declared'
  ) then
    alter table public.products
      add constraint products_category_declared
      check (category is null or category in (
        'tees', 'knitwear', 'hoodies', 'bottoms', 'totes', 'headwear', 'collectibles'
      ));
  end if;

  -- `collections` is text[], so this asserts containment: every element must be
  -- declared. The empty array trivially satisfies it, which is the default and
  -- the common case.
  if not exists (
    select 1 from pg_constraint where conname = 'products_collections_declared'
  ) then
    alter table public.products
      add constraint products_collections_declared
      check (collections <@ array['the-rabbit-hole', 'best-sellers', 'fall-lookbook']::text[]);
  end if;
end
$$;
