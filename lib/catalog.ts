import {
  isCategorySlug,
  isCollectionSlug,
  isDepartmentSlug,
  type CategorySlug,
  type CollectionSlug,
  type DepartmentSlug,
} from "./taxonomy";
import { createClient } from "./supabase/server";

/**
 * Catalog reads. Issues #9 and #10, per ADR 0002.
 *
 * The one place that knows how the storefront asks "what can a shopper see, and
 * how much of it can they actually buy". Any later catalog surface extends this
 * file rather than writing its own query -- the Available Stock rule below is
 * easy to get subtly wrong in a second place.
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

/** The columns the storefront needs, and the Variant embed, in one round trip. */
const CATALOG_SELECT = `
  id,
  slug,
  name,
  description,
  price,
  image_url,
  is_new,
  department,
  category,
  collections,
  variants_available (
    id,
    color,
    size,
    available_stock
  )
` as const;

export type CatalogVariant = {
  id: string;
  color: string;
  size: string;
  /** Available Stock per CONTEXT.md -- stock minus unexpired Reservations. */
  availableStock: number;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Decimal dollars, not cents. Converted at the Stripe boundary in #15. */
  price: number;
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
  image_url: string | null;
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
};

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

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    price: row.price,
    imageUrl: row.image_url,
    isNew: row.is_new,
    department: row.department,
    category: row.category,
    collections: row.collections,
    variants,
  };
}

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
 * filter panel in #37 emits repeated params, and it should not have to reopen
 * the query layer to do it.
 */
export type CatalogFilters = {
  departments: DepartmentSlug[];
  categories: CategorySlug[];
  collections: CollectionSlug[];
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

/** Next hands search params as `string | string[] | undefined` per key. */
type RawSearchParams = Record<string, string | string[] | undefined>;

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
function keepDeclared<T extends string>(
  raw: string[],
  isDeclared: (value: string) => value is T,
): { values: T[]; allUnknown: boolean } {
  const values = [...new Set(raw.filter(isDeclared))];
  return { values, allUnknown: raw.length > 0 && values.length === 0 };
}

/**
 * Validates URL search params into filters, or returns null when the URL names a
 * dimension whose every value is undeclared -- the page turns that into a 404.
 *
 * "Declared" means present in lib/taxonomy.ts. That file is the storefront's
 * half of the contract; the database enforces the same list with CHECK
 * constraints, so a Product cannot hold a slug this rejects (ADR 0011).
 */
export function parseCatalogFilters(params: RawSearchParams): CatalogFilters | null {
  const department = keepDeclared(asList(params.department), isDepartmentSlug);
  const category = keepDeclared(asList(params.category), isCategorySlug);
  const collection = keepDeclared(asList(params.collection), isCollectionSlug);

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
// Queries
// ---------------------------------------------------------------------------

/**
 * Every visible Product matching the filters, newest first.
 *
 * Filtering happens in Postgres, against the indexes the schema already carries
 * (`products_department_idx`, `products_category_idx`, and a GIN index on
 * `collections`) -- not by fetching the catalog and filtering in JavaScript. The
 * seeded catalog is placeholder data (#5) and the real one is substantially
 * larger; see CLAUDE.md on not sizing decisions by the current row count.
 */
export async function getProducts(
  filters: CatalogFilters = NO_FILTERS,
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

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load products: ${error.message}`);

  return (data as RawProduct[]).map(toCatalogProduct);
}

/** One visible Product, or null when the slug matches nothing the caller may see. */
export async function getProductBySlug(slug: string): Promise<CatalogProduct | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(CATALOG_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load product "${slug}": ${error.message}`);

  return data ? toCatalogProduct(data as RawProduct) : null;
}
