import { createClient } from "./supabase/server";

/**
 * Catalog reads. Issue #9, per ADR 0002.
 *
 * The one place that knows how the storefront asks "what can a shopper see, and
 * how much of it can they actually buy". #10's taxonomy filters and any later
 * catalog surface extend this file rather than writing their own query -- the
 * Available Stock rule below is easy to get subtly wrong in a second place.
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

/** Every visible Product, newest first. */
export async function getProducts(): Promise<CatalogProduct[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(CATALOG_SELECT)
    .order("created_at", { ascending: false });

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
