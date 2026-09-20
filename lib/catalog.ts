import {
  CATEGORY_SLUGS,
  COLLECTION_SLUGS,
  DEPARTMENT_SLUGS,
} from "./taxonomy";
import {
  DEFAULT_SORT,
  NO_FILTERS,
  type CatalogFacets,
  type CatalogFilters,
  type CatalogSort,
} from "./catalog-url";
import { cache } from "react";

import { createClient } from "./supabase/server";

/**
 * Catalog reads. Issues #9, #10 and #37, per ADR 0002.
 *
 * The one place that knows how the storefront asks "what can a shopper see, and
 * how much of it can they actually buy". Any later catalog surface extends this
 * file rather than writing its own query -- the Available Stock rule below is
 * easy to get subtly wrong in a second place.
 *
 * What a catalog URL *means* -- the filter and sort vocabulary, and the parsing
 * that validates it -- lives in lib/catalog-url.ts instead, and is re-exported
 * below so `@/lib/catalog` stays the single door for server-side callers. That
 * file has to stay importable from a `"use client"` component; this one never
 * can, because it reaches `next/headers` through lib/supabase/server.ts.
 *
 * Two rules this module exists to enforce:
 *
 * - Variants come from `variants_available`, never from `variants`. The raw
 *   `stock` column is the physical count on the shelf; `available_stock`
 *   subtracts unexpired Reservations (ADR 0010). Showing the raw count sells the
 *   last unit twice. See the comment block in
 *   supabase/migrations/20260825120100_products_variants_reservations.sql.
 *
 * - Hidden Products are excluded by RLS and by the view itself, so nothing here
 *   filters on `is_hidden`. Adding a client-side filter would imply the database
 *   isn't already doing it, which is exactly the wrong thing to imply.
 */

// The URL contract, re-exported so existing callers keep importing one module.
// Client components must import these from "@/lib/catalog-url" directly.
export {
  CATALOG_SORTS,
  DEFAULT_SORT,
  NO_FILTERS,
  catalogUrlKey,
  hasActiveFilters,
  parseCatalogFilters,
  parseCatalogSort,
  type CatalogFacets,
  type CatalogFilters,
  type CatalogSort,
  type CatalogVocabulary,
} from "./catalog-url";

/** The columns the storefront needs, and both embeds, in one round trip. */
const CATALOG_SELECT = `
  id,
  slug,
  name,
  description,
  price,
  is_new,
  department,
  category,
  collections,
  variants_available (
    id,
    color,
    size,
    available_stock
  ),
  product_images (
    url,
    sort_order,
    color,
    created_at
  )
` as const;

export type CatalogVariant = {
  id: string;
  color: string;
  size: string;
  /** Available Stock per CONTEXT.md -- stock minus unexpired Reservations. */
  availableStock: number;
};

/** One image from a Product's gallery (#11, ADR 0009 amended). */
export type ProductImage = {
  url: string;
  /**
   * Which Variant colour this image shows, or null for "any".
   *
   * Carried through from the database and deliberately unread by every current
   * caller -- see the column comment in
   * supabase/migrations/20260919120000_product_images.sql. Wiring it is a change
   * to ProductDetail.tsx alone.
   */
  color: string | null;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Decimal dollars, not cents. Converted at the Stripe boundary in #15. */
  price: number;
  /**
   * The gallery, already in display order. Empty when the client has not
   * uploaded anything yet, which is a state the storefront has to render
   * rather than a broken row -- the catalog is still placeholder data (#5).
   */
  images: ProductImage[];
  /**
   * The card image: `images[0]`, derived and never stored.
   *
   * This exists so the grid, /cart, the Open Graph tag and the Stripe line item
   * did not all have to change when ADR 0009 was amended from one image to a
   * gallery. Keeping a second *column* for it is what that amendment explicitly
   * rejected -- two answers to "what is the main image" is how those surfaces
   * come to disagree. One derived field, one source.
   */
  imageUrl: string | null;
  isNew: boolean;
  department: string | null;
  category: string | null;
  collections: string[];
  variants: CatalogVariant[];
};

/**
 * Sizes sort by convention, not alphabetically -- Postgres has no opinion about
 * whether L comes before M, and "L, M, S" on a size picker looks broken.
 * Anything unrecognised sorts to the end in its original order.
 */
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "OS"];

function sizeRank(size: string) {
  const i = SIZE_ORDER.indexOf(size.toUpperCase());
  return i === -1 ? SIZE_ORDER.length : i;
}

/**
 * A view's columns are all nullable as far as Postgres is concerned -- views
 * don't carry NOT NULL constraints, so the generated types mark every one
 * `| null`. Normalising here means no component has to reason about a Variant
 * with no size, and a genuinely broken row is dropped rather than rendered.
 */
type RawProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  is_new: boolean;
  department: string | null;
  category: string | null;
  collections: string[];
  variants_available: {
    id: string | null;
    color: string | null;
    size: string | null;
    available_stock: number | null;
  }[];
  product_images: {
    url: string | null;
    sort_order: number | null;
    color: string | null;
    created_at: string | null;
  }[];
};

/**
 * Gallery order: `sort_order` ascending, ties broken on `created_at`.
 *
 * Sorted here rather than with `.order(..., { referencedTable })` so that every
 * query using CATALOG_SELECT gets the same order without having to remember to
 * ask for it -- the same reason Variants are sorted in `toCatalogProduct`. The
 * tiebreak is not decoration: `product_images` has no unique constraint on
 * (product_id, sort_order), deliberately, so that reordering a gallery is a
 * plain UPDATE. Without the tiebreak, two images the client left at the default
 * 0 would swap places between requests for no visible reason.
 */
function toProductImages(rows: RawProduct["product_images"]): ProductImage[] {
  return rows
    .filter((i) => i.url !== null)
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    )
    .map((i) => ({ url: i.url!, color: i.color }));
}

function toCatalogProduct(row: RawProduct): CatalogProduct {
  const variants = row.variants_available
    .filter((v) => v.id !== null && v.color !== null && v.size !== null)
    .map((v) => ({
      id: v.id!,
      color: v.color!,
      size: v.size!,
      availableStock: v.available_stock ?? 0,
    }))
    .sort((a, b) => a.color.localeCompare(b.color) || sizeRank(a.size) - sizeRank(b.size));

  const images = toProductImages(row.product_images);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    price: row.price,
    images,
    imageUrl: images[0]?.url ?? null,
    isNew: row.is_new,
    department: row.department,
    category: row.category,
    collections: row.collections,
    variants,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Every visible Product matching the filters, in the requested order.
 *
 * Filtering and sorting both happen in Postgres, against the indexes the schema
 * already carries (`products_department_idx`, `products_category_idx`, and a GIN
 * index on `collections`) -- not by fetching the catalog and working on it in
 * JavaScript. The seeded catalog is placeholder data (#5) and the real one is
 * substantially larger; see CLAUDE.md on not sizing decisions by the current row
 * count.
 */
export async function getProducts(
  filters: CatalogFilters = NO_FILTERS,
  sort: CatalogSort = DEFAULT_SORT,
): Promise<CatalogProduct[]> {
  const supabase = await createClient();

  let query = supabase.from("products").select(CATALOG_SELECT);

  // AND across dimensions: each filter narrows what the previous one left.
  if (filters.departments.length > 0) query = query.in("department", filters.departments);
  if (filters.categories.length > 0) query = query.in("category", filters.categories);
  // `collections` is text[], so membership is array overlap (&&), not equality:
  // a Product on both "Best Sellers" and "Fall Lookbook" matches either link.
  if (filters.collections.length > 0) query = query.overlaps("collections", filters.collections);
  if (filters.isNew) query = query.eq("is_new", true);

  // PostgREST's .order() takes a column name, never an expression, so every sort
  // has to be expressible as columns. Price sorts carry a `created_at` tiebreak:
  // without one, two Products at the same price come back in whatever order
  // Postgres finds them, which can differ between two loads of the same URL.
  if (sort === "price-asc" || sort === "price-desc") {
    query = query.order("price", { ascending: sort === "price-asc" });
  }
  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) throw new Error(`Failed to load products: ${error.message}`);

  return (data as RawProduct[]).map(toCatalogProduct);
}

/**
 * The taxonomy terms that currently have at least one visible Product, in the
 * order lib/taxonomy.ts declares them.
 *
 * The drawer offers these rather than the full declared vocabulary: with the
 * placeholder catalog (#5) five of seven categories are empty, and a checkbox
 * that always returns nothing is worse than a shorter list.
 *
 * Reads the `catalog_facets` view, which does the distinct-and-unnest in
 * Postgres and, running with invoker rights, drops Hidden Products' terms
 * through RLS without this code knowing about the Hidden rule. Issue #38 repoints
 * that view at real taxonomy tables; this function's shape does not change.
 */
export async function getCatalogFacets(): Promise<CatalogFacets> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("catalog_facets").select("dimension, value");

  if (error) throw new Error(`Failed to load catalog facets: ${error.message}`);

  // View columns are nullable as far as Postgres is concerned, and the guards
  // below double as the narrowing that makes each list typed. A term the
  // storefront does not declare cannot reach here -- the CHECK constraints in
  // 20260830120000_taxonomy_declared_values.sql see to that -- but if the two
  // halves of ADR 0011 ever drift, dropping the unknown value is the right
  // failure: an undeclared slug has no label and would 404 if ticked.
  const present = new Set(
    (data ?? [])
      .filter((row) => row.dimension !== null && row.value !== null)
      .map((row) => `${row.dimension}:${row.value}`),
  );

  // Declaration order, not alphabetical or database order, so the drawer reads
  // in the same sequence as the mega menu.
  return {
    departments: DEPARTMENT_SLUGS.filter((slug) => present.has(`department:${slug}`)),
    categories: CATEGORY_SLUGS.filter((slug) => present.has(`category:${slug}`)),
    collections: COLLECTION_SLUGS.filter((slug) => present.has(`collection:${slug}`)),
  };
}

/**
 * One visible Product, or null when the slug matches nothing the caller may see.
 *
 * Wrapped in React's `cache` because the detail page calls it twice per request:
 * once in `generateMetadata` and once in the page body. Next.js dedupes `fetch`
 * for you, but not a supabase-js call, so without this every product view costs
 * two round trips to render one page. The memo lives for one request, which is
 * exactly right on a force-dynamic page -- two reads inside a single request
 * returning the same stock count is correct, not stale.
 */
export const getProductBySlug = cache(async (slug: string): Promise<CatalogProduct | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(CATALOG_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load product "${slug}": ${error.message}`);

  return data ? toCatalogProduct(data as RawProduct) : null;
});

// ---------------------------------------------------------------------------
// Cart resolution (#12, #13)
// ---------------------------------------------------------------------------

/** One Cart row's worth of live catalog data. */
export type ResolvedVariant = {
  variantId: string;
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  color: string;
  size: string;
  /** Decimal dollars, from the Product. */
  price: number;
  /** Available Stock per CONTEXT.md. */
  availableStock: number;
};

/**
 * Resolve Cart Item variant ids to what they cost and how many can be bought.
 *
 * A Cart Item stores only `{variantId, quantity}` (ADR 0001, amended
 * 2026-09-08), so this is what turns a Cart into something renderable. It
 * returns facts and no verdicts -- whether a line is short, unavailable, or
 * fine is decided by `reconcile` in lib/cart.ts, which is where the money math
 * is tested.
 *
 * Ids that resolve to nothing are simply absent from the result. That is not an
 * error case to handle here: `variants_available` ends in `where not
 * p.is_hidden`, so a Product the client hides in Supabase Studio drops out of
 * the view, and `reconcile` already reports an absent Variant as unavailable.
 */
export async function getVariantsByIds(variantIds: string[]): Promise<ResolvedVariant[]> {
  if (variantIds.length === 0) return [];

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("variants_available")
    .select(
      `
      id,
      color,
      size,
      available_stock,
      products (
        slug,
        name,
        price,
        product_images (
          url,
          sort_order,
          color,
          created_at
        )
      )
    `,
    )
    .in("id", variantIds);

  if (error) throw new Error(`Failed to resolve cart variants: ${error.message}`);

  type RawResolved = {
    id: string | null;
    color: string | null;
    size: string | null;
    available_stock: number | null;
    products: {
      slug: string | null;
      name: string | null;
      price: number | null;
      product_images: RawProduct["product_images"];
    } | null;
  };

  // View columns arrive nullable because Postgres views carry no NOT NULL
  // constraints (see lib/database.types.ts). Normalise here so nothing
  // downstream reasons about `number | null` stock.
  return (data as unknown as RawResolved[])
    .filter((row) => row.id !== null && row.products !== null)
    .map((row) => ({
      variantId: row.id as string,
      productSlug: row.products?.slug ?? "",
      productName: row.products?.name ?? "",
      // The card image, by the same rule as CatalogProduct.imageUrl -- so the
      // Cart row and the Stripe line item show what the catalogue grid showed.
      imageUrl: toProductImages(row.products?.product_images ?? [])[0]?.url ?? null,
      color: row.color ?? "",
      size: row.size ?? "",
      price: Number(row.products?.price ?? 0),
      availableStock: row.available_stock ?? 0,
    }));
}
