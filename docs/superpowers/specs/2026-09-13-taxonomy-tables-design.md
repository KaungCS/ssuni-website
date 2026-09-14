# Taxonomy tables: design for issue #49

**Date:** 2026-09-13
**Issue:** [#49](https://github.com/KaungCS/ssuni-website/issues/49) (supersedes #38)
**ADRs:** [0011](../../adr/0011-taxonomy-is-a-declared-list.md), [0013](../../adr/0013-taxonomy-tables-and-the-vocabulary-argument.md)
**Status:** approved, ready for an implementation plan

## What this document is for

Issue #49 and ADR 0013 already settle the shape of this work: a join table rather
than a trigger, display labels in rows rather than TypeScript, a vocabulary that
reaches `parseCatalogFilters` as an argument, an explicit `sort_order`, and no
`is_active` flag. **None of that is re-argued here.**

This document records the decisions those two left open or got wrong, and the
concrete plan that follows from them.

## Decisions this document adds

### 1. Story 6 gets a `taxonomy_term_usage` view

`on delete restrict` raises a foreign-key violation naming the constraint, not
the Products holding the Term. A view with one row per Term and a live
`product_count` lets the client sort by count in Supabase Studio and see what
must be reassigned before a Term can retire.

It runs with **invoker rights**, which answers both audiences correctly from one
definition: `products_select_visible` is `using (not is_hidden or
public.is_admin())`, so the client sees Hidden Products in the count while anon
does not. That matters — **a Hidden Product still blocks deletion**, so a count
that omitted it would tell the client a Term was safe when it was not.

### 2. `catalog_facets` is dropped, not re-pointed

ADR 0013 says the facets view "survives, re-pointed, as what answers the flag."
Rejected. Its only caller is `getCatalogFacets()`, which is being replaced, and
`catalog_taxonomy` answers `has_products` directly. Keeping both means two views
computing the same predicate over the same rows.

### 3. `lib/taxonomy.ts` is deleted, not emptied

ADR 0013 says the module "keeps its types and loses its vocabulary." There are no
types left to keep: `DepartmentSlug`, `CategorySlug` and `CollectionSlug` are all
derived via `keyof typeof` from the const objects being removed, and the three
label functions are replaced by one `labelOf` helper. The file would be an empty
shell. Delete it.

### 4. `collections` leaves the Product query

ADR 0013 says "the Product query is not touched: `CATALOG_SELECT` and its
`variants_available` embed stay exactly as they are." This is not achievable —
`CATALOG_SELECT` selects the `collections` column that the migration drops.

The damage is small because **nothing renders the field**: the only reference in
the repo is `lib/catalog.ts` copying it onto `CatalogProduct`. So the column
leaves both the select and the type, and only the *filter* needs a new shape.
The `variants_available` embed is genuinely untouched.

### 5. The taxonomy read is memoized with React `cache()`

`app/catalog/page.tsx` flags this explicitly: `generateMetadata` and the page each
parse the URL, so from #49 each would load the taxonomy, doubling the round trip.

Next's bundled docs (`generate-metadata.md`) state that memoization spans
`generateMetadata`, layouts and pages within one render pass, and that React
`cache` is the documented mechanism when the data source is not `fetch`. Wrapping
`getCatalogTaxonomy` in `cache()` gives one taxonomy read per request. The
deferred-decision comment in the page is replaced with this outcome.

## Schema

A single migration, `supabase/migrations/20260913120000_taxonomy_tables.sql`.

### Vocabulary tables

Three tables of identical shape, keyed by slug:

```sql
create table public.departments (
  slug       text primary key,
  name       text not null,
  sort_order integer not null,
  created_at timestamptz not null default now()
);
-- categories and collections are identical
```

Seeded from the current `lib/taxonomy.ts` lists in declaration order at
`sort_order` 10, 20, 30 … — gaps so a Term can be reordered without renumbering
its neighbours.

| Table | Slugs, in seeded order |
|---|---|
| `departments` | `women`, `men`, `unisex` |
| `categories` | `tees`, `knitwear`, `hoodies`, `bottoms`, `totes`, `headwear`, `collectibles` |
| `collections` | `the-rabbit-hole`, `best-sellers`, `fall-lookbook` |

### Product foreign keys

`products.department` and `products.category` **stay `text` and stay nullable.**
They already hold exactly these slugs, so they gain a constraint and no row is
rewritten. Nullable preserves today's behaviour, which story 11 requires; making
them `NOT NULL` is a separate decision about what the client must supply, and #49
does not ask for it.

```sql
alter table public.products
  add constraint products_department_fkey
  foreign key (department) references public.departments(slug)
  on update cascade on delete restrict;
```

`on update cascade` so correcting a slug propagates instead of orphaning;
`on delete restrict` is story 5. The three CHECK constraints from
`20260830120000_taxonomy_declared_values.sql` are dropped — the foreign keys
supersede them.

### The join table

```sql
create table public.product_collections (
  product_id      uuid not null
    references public.products(id) on delete cascade,
  collection_slug text not null
    references public.collections(slug) on update cascade on delete restrict,
  primary key (product_id, collection_slug)
);
create index product_collections_collection_idx
  on public.product_collections (collection_slug);
```

The two delete rules are deliberately asymmetric. Deleting a **Product** cascades
— removing it from its shelves is the correct consequence. Deleting a
**Collection** restricts — that is the guarantee this issue exists to provide.

### Backfill and its guard

```sql
select count(*) into expected
from (select distinct p.id, c
      from public.products p, unnest(p.collections) c) t;

insert into public.product_collections (product_id, collection_slug)
select distinct p.id, c from public.products p, unnest(p.collections) c;

get diagnostics inserted = row_count;

if inserted <> expected then
  raise exception 'product_collections backfill lost rows: expected %, got %',
    expected, inserted;
end if;
```

Note `distinct` on **both** sides. A Product whose array happened to list the
same Collection twice would otherwise make the raw `unnest` count exceed the
inserted count — the primary key collapses the duplicate correctly, and an
un-distincted guard would abort a migration that had actually succeeded.

`products.collections` is dropped only after this passes.

### Migration order

1. Create the three vocabulary tables and `product_collections`
2. Seed the vocabulary
3. Add the Product foreign keys; drop the three CHECK constraints
4. Backfill `product_collections`; verify; abort on mismatch
5. Drop `products.collections` and its GIN index
6. Create `catalog_taxonomy` and `taxonomy_term_usage`; drop `catalog_facets`
7. Enable RLS and add policies

## Row-level security

The three vocabulary tables are public reference data:

```sql
create policy departments_select_all on public.departments
  for select to anon, authenticated using (true);

create policy departments_admin_write on public.departments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

`product_collections` is different: its rows are *about* Products, so its select
policy **mirrors `variants_select_visible`** rather than being unconditional.

```sql
create policy product_collections_select_visible on public.product_collections
  for select to anon, authenticated
  using (exists (
    select 1 from public.products p where p.id = product_collections.product_id
  ));
```

The subquery is itself subject to the products policy, so a Hidden Product's
memberships drop out for anon and stay for admins — the same trick `variants`
already uses, and the reason `catalog_taxonomy` below needs no explicit
`is_hidden` logic of its own.

## Views

Both take `security_invoker = true`, for the reason spelled out at length in
`20260831120000_catalog_facets.sql`: they read only `products` and
`product_collections`, so invoker rights let the existing policies answer the
Hidden question rather than re-implementing it.

```sql
create view public.catalog_taxonomy with (security_invoker = true) as
  select 'department' as dimension, d.slug, d.name, d.sort_order,
         exists (select 1 from public.products p where p.department = d.slug)
           as has_products
  from public.departments d
  union all
  select 'category', c.slug, c.name, c.sort_order,
         exists (select 1 from public.products p where p.category = c.slug)
  from public.categories c
  union all
  select 'collection', col.slug, col.name, col.sort_order,
         exists (select 1 from public.product_collections pc
                 where pc.collection_slug = col.slug)
  from public.collections col;
```

The collection branch needs no join to `products` precisely because of the
policy above — under invoker rights, a Hidden Product's join rows are already
invisible.

`taxonomy_term_usage` has the same three-branch shape but reports
`count(*)` per Term instead of `exists`, and carries no `sort_order` — it is a
maintenance read, not a rendering one.

## TypeScript

### `lib/catalog-url.ts` — stays pure, still imports nothing

Gains:

```ts
export type TaxonomyTerm = {
  slug: string;
  name: string;
  sortOrder: number;
  hasProducts: boolean;
};

export type CatalogTaxonomy = {
  departments: TaxonomyTerm[];
  categories: TaxonomyTerm[];
  collections: TaxonomyTerm[];
};

export function vocabularyOf(taxonomy: CatalogTaxonomy): CatalogVocabulary;
export function labelOf(terms: readonly TaxonomyTerm[], slug: string): string;
```

Loses `CatalogFacets`. **No parsing rule changes at all** — `parseCatalogFilters`,
`parseCatalogSort`, `catalogUrlKey` and `hasActiveFilters` are untouched. That is
the payoff #50 bought, and it is the thing to check has actually held when the
work is reviewed.

`labelOf` falls back to the raw slug, matching the current `categoryLabel`
behaviour.

### `lib/taxonomy.ts` — deleted

Its four importers (`app/catalog/page.tsx`, `components/CatalogFilterDrawer.tsx`,
`components/ProductGrid.tsx`, `lib/catalog.ts`) all move to `@/lib/catalog-url`
or take props.

### `lib/catalog.ts`

- `getCatalogFacets()` → `getCatalogTaxonomy()`, wrapped in React `cache()`,
  reading `catalog_taxonomy` ordered by `sort_order` and grouping by `dimension`.
- `collections` leaves `CATALOG_SELECT` and `CatalogProduct`. `department` and
  `category` stay on both, unchanged, as `string | null` slugs — only the array
  field goes.
- Collection filtering becomes an inner-join embed, appended to the select **only
  when a collection filter is present**:

  ```ts
  .select(`${CATALOG_SELECT}, product_collections!inner()`)
  .in("product_collections.collection_slug", filters.collections)
  ```

  Verified against the live database on 2026-09-13: `!inner` returns one parent
  row per Product with no duplication even when several children match, and the
  sibling `variants_available` embed still comes back complete rather than being
  narrowed by the filter. Both were the failure modes worth checking.

- The re-export block drops `CatalogFacets` and adds the new taxonomy types.

### Components

`CatalogFilterDrawer` takes `taxonomy: CatalogTaxonomy` instead of `facets`,
renders the terms where `hasProducts` is true, and reads each checkbox label from
`term.name`. Order comes from the view, so the component does no sorting. It
remains a `next/form` GET form keyed on the current search params — neither trap
recorded in CLAUDE.md is affected.

`ProductGrid` takes a `categoryLabels: Record<string, string>` prop built by the
page. This is mild prop-drilling, and it is the ADR 0013 decision: the page holds
the vocabulary anyway to parse the URL, so a join on the Product query would be
paying twice for the same labels.

`app/catalog/page.tsx` loads the taxonomy, derives the vocabulary, parses, 404s
on `null`, then fetches Products.

## Consequences

**The catalog page loses a parallel read.** Today it does
`Promise.all([getProducts, getCatalogFacets])`. Parsing now depends on the
vocabulary, so the taxonomy read must complete before `getProducts` can be
issued: two round trips in series where there were two in parallel. The taxonomy
read is thirteen rows against primary keys, so the added latency is one
round trip and not a query cost — but story 18 asks that filtering stay as fast
as it is now, and this is a small honest regression against that. `cache()`
prevents `generateMetadata` from making it a third.

**The vocabulary still lives in two places until #51.** `ShopDropdown.tsx`
hardcodes thirteen links with their labels. A Category the client adds will
filter correctly and appear in the drawer while being absent from the navigation.

**There is a window where the live catalog 500s**, accepted by ADR 0013: the
database migrates from a laptop while code deploys from a push, so one side is
ahead of the other in between. Acceptable pre-launch, not in October.

## Testing

TDD is not required here — CLAUDE.md scopes that to Cart math, the reservation
RPC, and the Stripe webhook. Schema is proved by querying the real database.

**`supabase/tests/rls.mjs`** — note this is a rewrite, not only an extension. The
file currently has five assertions reading `catalog_facets`, and that view is
being dropped; they are re-pointed at `catalog_taxonomy`'s `has_products` flag,
which is the same invariant expressed against the replacement. It also selects
`collections` from `products` in two places, which the dropped column breaks.
New coverage:
- anon can read all three vocabulary tables and `catalog_taxonomy`
- anon writes to each are rejected
- `has_products` for a Term flips to `false` when the only Product carrying it is
  hidden, and back on revert — reusing the existing hoodie hide/revert dance
- `product_collections` rows for a Hidden Product are invisible to anon

**`supabase/tests/admin-path.sql`** extends, inside its rolled-back transaction:
- inserting a Product with an undeclared category raises a foreign-key violation
  (story 4)
- deleting a Term that Products hold raises a foreign-key violation (story 5)
- `taxonomy_term_usage` reports a count matching a direct query

No assertion may use an exact catalog row count — floors, runtime baselines, or
the property itself, per CLAUDE.md. Six such assertions broke at once on
2026-08-30 when a Product appeared between sessions.

**`lib/catalog-url.test.ts`** extends to cover `vocabularyOf` and `labelOf`,
including the raw-slug fallback.

**Also required:** `npm run db:types` after the migration, committed;
`npm run db:verify` green; `npm run lint` at 6 warnings / 0 errors;
`npm run cf:preview` before merging.

## Out of scope

- **#51** — the mega menu reading the taxonomy tables. Deliberately separate, per
  ADR 0013.
- The Admin Dashboard's category editor (ADR 0007) — these tables are its
  prerequisite, not part of it.
- Ordering *within* a Collection. No one has asked for it; a `position` column on
  the join table is the shape if they do.
- `NOT NULL` on the Product taxonomy columns.

## Follow-up

ADR 0013 needs an amendment recording decisions 2, 3 and 4 above — the facets
drop, the module deletion, and the Product-query correction. The ADR's claim that
the Product query is untouched is the one that would actively mislead a future
reader, since it reads as a constraint on the implementation.
