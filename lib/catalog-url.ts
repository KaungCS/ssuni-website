/**
 * What a catalog URL means: the filter and sort vocabulary, and the parsing that
 * validates it. Issues #10 and #37.
 *
 * This is deliberately separate from lib/catalog.ts, which owns the *queries*.
 * The split is not decorative -- it is a hard requirement. lib/catalog.ts
 * reaches `next/headers` through lib/supabase/server.ts, so importing any
 * runtime value from it inside a `"use client"` component pulls the server
 * client into the browser bundle and the build fails with "You're importing a
 * module that depends on next/headers". The filter drawer needs the sort
 * vocabulary and the filter shape; it must never need a query.
 *
 * So: anything a client component might legitimately want lives here, and this
 * file imports nothing at all. lib/catalog.ts re-exports all of it, so
 * server-side callers can keep treating `@/lib/catalog` as the single door.
 */

// ---------------------------------------------------------------------------
// Vocabulary (#50)
// ---------------------------------------------------------------------------

/**
 * The declared Taxonomy Terms, by dimension -- what this module is allowed to
 * consider real.
 *
 * It arrives as an argument rather than being read from a module of its own,
 * because #49 moves the vocabulary into Postgres. A parser that fetched it
 * would have to be async and would reach `next/headers`, which is precisely
 * what this file exists not to do; every rule below would then need a database
 * to test. lib/cart.ts already makes this trade with Available Stock.
 *
 * Slugs only. Display labels are a rendering concern and no rule here depends
 * on them, so widening this to whole Terms would be a wider interface than the
 * job needs.
 */
export type CatalogVocabulary = {
  departments: readonly string[];
  categories: readonly string[];
  collections: readonly string[];
};

// ---------------------------------------------------------------------------
// Filters (#10)
// ---------------------------------------------------------------------------

/**
 * A validated set of catalog filters. Every slug in here is known-good: parsing
 * happens once, at the URL boundary, so nothing downstream re-validates.
 *
 * Dimensions combine with AND ("Women, in Hoodies"); values within one dimension
 * combine with OR ("Hoodies or Knitwear"). The multi-value shape is here from
 * the start even though today's nav only ever links one value at a time -- the
 * filter drawer (#37) emits repeated params, and it did not have to reopen the
 * query layer to do it.
 *
 * The slugs are plain strings rather than a union of the declared Terms. That
 * narrowing died with #50 on purpose: the vocabulary is data the database owns
 * from #49 onwards, so no type can enumerate it at compile time. What keeps a
 * bad slug out is parseCatalogFilters, which is why every value in here is
 * known-good.
 */
export type CatalogFilters = {
  departments: string[];
  categories: string[];
  collections: string[];
  isNew: boolean;
};

export const NO_FILTERS: CatalogFilters = {
  departments: [],
  categories: [],
  collections: [],
  isNew: false,
};

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return (
    filters.departments.length > 0 ||
    filters.categories.length > 0 ||
    filters.collections.length > 0 ||
    filters.isNew
  );
}

/**
 * The terms that currently have at least one visible Product -- what the drawer
 * offers, as opposed to the full declared vocabulary in lib/taxonomy.ts.
 * Produced by getCatalogFacets() in lib/catalog.ts; the shape lives here so the
 * drawer can name it without importing the query module.
 */
export type CatalogFacets = {
  departments: string[];
  categories: string[];
  collections: string[];
};

/** Next hands search params as `string | string[] | undefined` per key. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v.length > 0);
}

/**
 * Keeps the values a dimension recognises, and reports whether the dimension was
 * asked for but understood not at all.
 *
 * The distinction matters for what the page does next.
 * `?category=tees&category=nope` still describes something real, so the unknown
 * value is dropped and the shopper gets tees. `?category=nope` describes
 * nothing, and rendering the full catalog there would silently ignore what they
 * asked for -- so the page 404s instead.
 */
function keepDeclared(
  raw: string[],
  declared: readonly string[],
): { values: string[]; allUnknown: boolean } {
  const declaredSet = new Set(declared);
  const values = [...new Set(raw.filter((value) => declaredSet.has(value)))];
  return { values, allUnknown: raw.length > 0 && values.length === 0 };
}

/**
 * Validates URL search params into filters, or returns null when the URL names a
 * dimension whose every value is undeclared -- the page turns that into a 404.
 *
 * "Declared" means present in the vocabulary the caller passes in -- nothing
 * more. This function has no opinion about which Terms the shop actually sells,
 * which is what lets the storefront move that list from a TypeScript constant
 * (#50) into Postgres (#49) without touching a single rule below.
 */
export function parseCatalogFilters(
  params: RawSearchParams,
  vocabulary: CatalogVocabulary,
): CatalogFilters | null {
  const department = keepDeclared(asList(params.department), vocabulary.departments);
  const category = keepDeclared(asList(params.category), vocabulary.categories);
  const collection = keepDeclared(asList(params.collection), vocabulary.collections);

  if (department.allUnknown || category.allUnknown || collection.allUnknown) return null;

  // `?new=true` is its own dimension: it maps to the is_new column rather than
  // to a curated grouping, which is why it is not a Collection. Any other value
  // is as meaningless as an undeclared slug, and 404s for the same reason.
  const rawNew = asList(params.new);
  if (rawNew.length > 0 && !rawNew.every((v) => v === "true" || v === "1")) return null;

  return {
    departments: department.values,
    categories: category.values,
    collections: collection.values,
    isNew: rawNew.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Sort (#37)
// ---------------------------------------------------------------------------

/**
 * The sort menu, in the order the drawer renders it. The first entry is the
 * default and is what bare `/catalog` has always done.
 *
 * There is no "Best Selling": it needs order history that does not exist until
 * #17/#18, and CONTEXT.md defines Best Sellers as a hand-curated Collection
 * rather than a computed ranking -- the Collection link carries that job.
 *
 * There is no "Featured" either, though #37 originally listed one. It was
 * defined as the existing `created_at desc` default, which is exactly what
 * Newest is, so the menu would have offered two labels for one ordering and a
 * shopper picking the second would watch nothing move. Curation lives in
 * Collections. If the client later wants to merchandise the top of the catalog,
 * that is a `featured_rank` column decided with real content in hand, not a
 * Collection doing double duty as a sort.
 */
export const CATALOG_SORTS = [
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number]["value"];

export const DEFAULT_SORT: CatalogSort = "newest";

function isCatalogSort(value: string): value is CatalogSort {
  return CATALOG_SORTS.some((s) => s.value === value);
}

/**
 * Reads `?sort=`, falling back to the default for anything unrecognised.
 *
 * Note the asymmetry with parseCatalogFilters, which returns null and lets the
 * page 404. That is deliberate, not an oversight. A dimension says *what you are
 * looking at*, so quietly ignoring `?category=hoodiez` would show the shopper a
 * different set of Products than they asked for. Sort says *what order*, and
 * falling back still shows the correct Products -- nobody is misled by
 * `?sort=cheapest` rendering in Newest order.
 *
 * `?sort=newest` is accepted and means exactly what no param at all means. The
 * drawer is a GET form and its radio group always submits, so pressing Apply on
 * a bare catalog produces that URL; both render the same page.
 */
export function parseCatalogSort(params: RawSearchParams): CatalogSort {
  const [raw] = asList(params.sort);
  return raw !== undefined && isCatalogSort(raw) ? raw : DEFAULT_SORT;
}

/**
 * The canonical query string for a validated view: the same set of filters
 * always produces the same key, whatever order or duplication the incoming URL
 * had. The drawer uses it to re-key its form (#37), so reopening the drawer
 * always shows what the URL says rather than abandoned ticks.
 */
export function catalogUrlKey(filters: CatalogFilters, sort: CatalogSort): string {
  const params = new URLSearchParams();
  if (filters.isNew) params.set("new", "true");
  for (const slug of filters.departments) params.append("department", slug);
  for (const slug of filters.categories) params.append("category", slug);
  for (const slug of filters.collections) params.append("collection", slug);
  params.set("sort", sort);
  return params.toString();
}
