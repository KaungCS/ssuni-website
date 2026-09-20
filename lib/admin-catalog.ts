import { createClient } from "./supabase/server";

/**
 * Catalog reads and writes for the Admin Dashboard. Issue #21's siblings, per
 * ADR 0007 (amended 2026-09-19).
 *
 * Separate from lib/catalog.ts on purpose, and not because of layering. The two
 * want genuinely different shapes:
 *
 * - The storefront reads `variants_available` for Available Stock and must
 *   never see the raw count (ADR 0010). The admin needs **both** numbers --
 *   the shelf count is what they restock against, Available Stock is what
 *   explains why the storefront says something different.
 * - The storefront never sees a Hidden Product. The admin's whole job includes
 *   the ones nobody can buy yet.
 * - The admin needs row ids for images and variants so it can delete them.
 *
 * lib/orders.ts took the opposite decision and grew an admin half in-place,
 * because there the whole point was that both callers share ONE embed. Here
 * there is no shared embed to protect.
 *
 * Everything goes through RLS with the publishable key. `products_admin_write`,
 * `variants_admin_write` and `product_images_admin_write` are what permit these
 * writes; lib/supabase/admin.ts is not involved and must not be. A non-admin
 * calling any of them gets a policy refusal, not a silent success.
 *
 * Reaches next/headers, so no client component may import a runtime value.
 */

export type AdminVariant = {
  id: string;
  color: string;
  size: string;
  /** The physical count on the shelf. */
  stock: number;
  /** Stock minus unexpired held Reservations (ADR 0010). */
  availableStock: number;
};

export type AdminImage = {
  id: string;
  url: string;
  sortOrder: number;
  color: string | null;
};

export type AdminProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  isNew: boolean;
  isHidden: boolean;
  department: string | null;
  category: string | null;
  collections: string[];
  variants: AdminVariant[];
  images: AdminImage[];
};

export type AdminProductSummary = {
  id: string;
  slug: string;
  name: string;
  price: number;
  isHidden: boolean;
  variantCount: number;
  imageCount: number;
};

const ADMIN_PRODUCT_SELECT = `
  id,
  slug,
  name,
  description,
  price,
  is_new,
  is_hidden,
  department,
  category,
  collections,
  variants_available (
    id,
    color,
    size,
    stock,
    available_stock
  ),
  product_images (
    id,
    url,
    sort_order,
    color
  )
` as const;

type AdminProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  is_new: boolean;
  is_hidden: boolean;
  department: string | null;
  category: string | null;
  collections: string[];
  variants_available: {
    id: string | null;
    color: string | null;
    size: string | null;
    stock: number | null;
    available_stock: number | null;
  }[];
  product_images: {
    id: string;
    url: string;
    sort_order: number;
    color: string | null;
  }[];
};

/**
 * View columns arrive nullable -- Postgres views carry no NOT NULL constraints
 * -- so the same normalisation lib/catalog.ts does applies here. Variants sort
 * by colour then size *as typed*, not by the storefront's SIZE_ORDER
 * convention: the admin is scanning a table they maintain, and a stable
 * alphabetical order is easier to find a row in than a merchandising order.
 */
function toAdminProduct(row: AdminProductRow): AdminProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    isNew: row.is_new,
    isHidden: row.is_hidden,
    department: row.department,
    category: row.category,
    collections: row.collections,
    variants: row.variants_available
      .filter((v) => v.id !== null && v.color !== null && v.size !== null)
      .map((v) => ({
        id: v.id!,
        color: v.color!,
        size: v.size!,
        stock: v.stock ?? 0,
        availableStock: v.available_stock ?? 0,
      }))
      .sort((a, b) => a.color.localeCompare(b.color) || a.size.localeCompare(b.size)),
    images: [...row.product_images].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({
      id: i.id,
      url: i.url,
      sortOrder: i.sort_order,
      color: i.color,
    })),
  };
}

/**
 * Every Product, Hidden ones included, newest first.
 *
 * "Included" is RLS doing it, not this query: `products_select_visible` is
 * `not is_hidden or private.is_admin()`, so the same statement returns the
 * whole catalog to an admin and the visible part to anybody else. There is
 * deliberately no `is_hidden` filter here to remove.
 */
export async function getAdminProducts(): Promise<AdminProductSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select("id, slug, name, price, is_hidden, variants(id), product_images(id)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load products: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: Number(row.price),
    isHidden: row.is_hidden,
    variantCount: row.variants?.length ?? 0,
    imageCount: row.product_images?.length ?? 0,
  }));
}

/** One Product in full, or null when the id matches nothing the admin may see. */
export async function getAdminProduct(id: string): Promise<AdminProduct | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(ADMIN_PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load product ${id}: ${error.message}`);

  return data ? toAdminProduct(data as unknown as AdminProductRow) : null;
}

// ---------------------------------------------------------------------------
// Writes. Each returns an error string or null, so callers can report rather
// than throw -- a duplicate slug is an ordinary thing for the client to type.
// ---------------------------------------------------------------------------

export type ProductFields = {
  slug: string;
  name: string;
  description: string | null;
  price: number;
  isNew: boolean;
  isHidden: boolean;
  department: string | null;
  category: string | null;
  collections: string[];
};

/**
 * FormData to ProductFields, validating only what the database cannot say for
 * itself.
 *
 * Deliberately does NOT re-check the taxonomy. `products_department_check`,
 * `products_category_check` and `products_collections_check` already refuse an
 * undeclared term (ADR 0011), and `writeError` below turns that refusal into a
 * sentence. A second copy of the vocabulary here would be a fourth place to
 * keep in step -- exactly what #49 exists to reduce -- and it would be the copy
 * that silently disagrees.
 *
 * What it does check is what no constraint expresses: a `not null` column
 * happily accepts the empty string, and `numeric` has no opinion about NaN.
 */
export function parseProductForm(form: FormData): ProductFields | { error: string } {
  const slug = String(form.get("slug") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const rawPrice = String(form.get("price") ?? "").trim();

  if (slug === "") return { error: "A Product needs a URL slug." };
  if (name === "") return { error: "A Product needs a name." };

  const price = Number(rawPrice);
  if (rawPrice === "" || !Number.isFinite(price) || price < 0) {
    return { error: "Price must be a number, and not negative." };
  }

  const description = String(form.get("description") ?? "").trim();
  const department = String(form.get("department") ?? "").trim();
  const category = String(form.get("category") ?? "").trim();

  return {
    slug,
    name,
    // Empty means "not set", which is a null column and not an empty string --
    // the taxonomy CHECKs are written as `is null or in (...)`, so "" would be
    // refused where absence is allowed.
    description: description === "" ? null : description,
    price,
    isNew: form.get("isNew") === "on",
    isHidden: form.get("isHidden") === "on",
    department: department === "" ? null : department,
    category: category === "" ? null : category,
    // Repeated checkboxes sharing one name, the same shape the catalog filter
    // drawer emits and parseCatalogFilters reads.
    collections: form.getAll("collections").map(String).filter((c) => c !== ""),
  };
}

export async function createProduct(fields: ProductFields): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .insert({
      slug: fields.slug,
      name: fields.name,
      description: fields.description,
      price: fields.price,
      is_new: fields.isNew,
      is_hidden: fields.isHidden,
      department: fields.department,
      category: fields.category,
      collections: fields.collections,
    })
    .select("id")
    .maybeSingle();

  if (error) return { error: writeError(error.message) };
  if (!data) return { error: "The Product was not created." };
  return { id: data.id };
}

export async function updateProduct(id: string, fields: ProductFields): Promise<string | null> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("products")
    .update({
      slug: fields.slug,
      name: fields.name,
      description: fields.description,
      price: fields.price,
      is_new: fields.isNew,
      is_hidden: fields.isHidden,
      department: fields.department,
      category: fields.category,
      collections: fields.collections,
    })
    .eq("id", id);

  return error ? writeError(error.message) : null;
}

/**
 * Deleting a Product cascades to its Variants and images, and is refused by
 * Postgres if any Order Item still references one of those Variants --
 * order_items holds a restrict foreign key so a sale's record cannot be erased
 * by tidying the catalog. Hiding is the right move for a discontinued Product;
 * this is for one created by mistake.
 */
export async function deleteProduct(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  return error ? writeError(error.message) : null;
}

export async function saveVariant(
  productId: string,
  variantId: string | null,
  color: string,
  size: string,
  stock: number,
): Promise<string | null> {
  const supabase = await createClient();

  const { error } = variantId
    ? await supabase.from("variants").update({ color, size, stock }).eq("id", variantId)
    : await supabase.from("variants").insert({ product_id: productId, color, size, stock });

  return error ? writeError(error.message) : null;
}

export async function deleteVariant(variantId: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("variants").delete().eq("id", variantId);
  return error ? writeError(error.message) : null;
}

export async function addImage(
  productId: string,
  url: string,
  sortOrder: number,
): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_images")
    .insert({ product_id: productId, url, sort_order: sortOrder });
  return error ? writeError(error.message) : null;
}

export async function setImageOrder(imageId: string, sortOrder: number): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_images")
    .update({ sort_order: sortOrder })
    .eq("id", imageId);
  return error ? writeError(error.message) : null;
}

/**
 * Removes the row. The file stays in the bucket, deliberately: a Storage delete
 * is a second failure mode on a different service, and an orphaned object costs
 * a few kilobytes against a quota, while deleting one still referenced by a row
 * this transaction did not remove would show the shopper a broken image. Sweep
 * the bucket separately if it ever matters.
 */
export async function deleteImage(imageId: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("product_images").delete().eq("id", imageId);
  return error ? writeError(error.message) : null;
}

/**
 * Postgres speaks to the database; the client should hear about the mistake
 * they actually made. Only the errors the client can cause by typing are
 * translated -- anything else is passed through, because a swallowed message
 * is worse than an ugly one.
 */
function writeError(message: string): string {
  if (message.includes("products_slug_key")) {
    return "Another Product already uses that URL slug.";
  }
  if (message.includes("variants_product_id_color_size_key")) {
    return "That colour and size already exist on this Product.";
  }
  if (message.includes("products_department_check") || message.includes("products_category_check")) {
    return "That department or category is not one of the declared values.";
  }
  if (message.includes("products_collections_check")) {
    return "One of those collections is not a declared value.";
  }
  if (message.includes("violates foreign key")) {
    return "Something still refers to this — a Variant that has been sold cannot be deleted.";
  }
  if (message.includes("row-level security")) {
    return "The database refused that write. Are you still signed in as an admin?";
  }
  return message;
}
