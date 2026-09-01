-- Catalog facets: the taxonomy terms that currently have Products. Issue #37.
--
-- The filter drawer lists only terms a shopper can actually reach. It does NOT
-- list the full vocabulary in lib/taxonomy.ts: with the placeholder catalog (#5)
-- five of seven categories are empty, and a checkbox that always returns nothing
-- is worse than a shorter list.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE CHANGING THE RIGHTS ON THIS VIEW.
-- ---------------------------------------------------------------------------
--
-- This view takes `security_invoker = true`. The variants_available view, two
-- migrations back, deliberately does the opposite and keeps definer rights, with
-- a comment block explaining that invoker rights there would silently report
-- full stock as available and oversell the last unit. Same repo, opposite
-- answer, and the difference is what each view reads:
--
--   variants_available reads public.reservations, which anon must never read.
--   Under invoker rights that subquery returns zero rows instead of raising, so
--   the view has to run as its owner to see the holds at all.
--
--   catalog_facets reads public.products and nothing else. Under invoker rights
--   the products select policy applies as-is, so a Hidden Product's terms drop
--   out of the facet list for free. Under DEFINER rights this view would run as
--   postgres, see Hidden Products, and offer the shopper a filter whose only
--   Products are ones they cannot see -- it would then have to re-implement the
--   Hidden rule itself, which is the duplication variants_available accepted
--   only because it had no choice.
--
-- So: invoker here, definer there, on purpose. Do not "fix" the inconsistency.
-- supabase/tests/rls.mjs proves the Hidden case against a real anon client.
--
-- Issue #38 replaces the taxonomy columns with real tables and foreign keys.
-- When it does, this view is re-pointed at those tables and lib/catalog.ts's
-- getCatalogFacets() -- and the drawer above it -- do not change.

create or replace view public.catalog_facets
with (security_invoker = true) as
      select 'department' as dimension, p.department as value
      from public.products p
      where p.department is not null
  union
      select 'category', p.category
      from public.products p
      where p.category is not null
  union
      select 'collection', c
      from public.products p, unnest(p.collections) as c;

-- `union`, not `union all`: one row per distinct (dimension, value) pair.

comment on view public.catalog_facets is
  'Taxonomy terms that currently have at least one visible Product, one row per (dimension, value). Read by lib/catalog.ts getCatalogFacets() to build the filter drawer. Runs with invoker rights on purpose -- see the comment block in the migration.';
