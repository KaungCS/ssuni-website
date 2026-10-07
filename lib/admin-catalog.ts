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
  /** The palette swatch (#83), null only if the colour row went missing. */
  colorHex: string | null;
  size: string;
  /** The physical count on the shelf. */
  stock: number;
  /** Stock minus unexpired held Reservations (ADR 0010). */
  availableStock: number;
  /**
   * This Variant appears in at least one Order, so its colour and size are
   * frozen (#84) -- they are what a receipt says was bought. Stock stays
   * editable. The trigger is the rule; this only stops the form offering a
   * write the database will refuse.
   */
  hasOrders: boolean;
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
    color_hex,
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
    color_hex: string | null;
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
function toAdminProduct(row: AdminProductRow, soldVariantIds: Set<string>): AdminProduct {
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
        colorHex: v.color_hex,
        size: v.size!,
        stock: v.stock ?? 0,
        availableStock: v.available_stock ?? 0,
        hasOrders: soldVariantIds.has(v.id!),
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
  if (!data) return null;

  const row = data as unknown as AdminProductRow;

  // Which of these Variants have been ordered (#84). A second round trip
  // rather than an embed: Variants arrive through `variants_available`, and
  // PostgREST cannot follow a foreign key through a view. The admin may read
  // order_items already -- `order_items_select_visible` defers to
  // `orders_admin_all`.
  const variantIds = row.variants_available.map((v) => v.id).filter((v): v is string => v !== null);
  const soldVariantIds = new Set<string>();

  if (variantIds.length > 0) {
    const { data: sold, error: soldError } = await supabase
      .from("order_items")
      .select("variant_id")
      .in("variant_id", variantIds);

    if (soldError) throw new Error(`Failed to load order history: ${soldError.message}`);
    for (const line of sold ?? []) soldVariantIds.add(line.variant_id);
  }

  return toAdminProduct(row, soldVariantIds);
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
  if (message.includes("variants_color_fkey")) {
    return "That colour is not in your palette, or is still in use by a Variant.";
  }
  if (message.includes("colors_hex_check")) {
    return "A colour needs a hex code like #8C947D.";
  }
  if (message.includes("colors_name_lower_key") || message.includes("colors_pkey")) {
    return "That colour name is already in your palette.";
  }
  if (message.includes("variant_sold_frozen")) {
    return "This Variant has been ordered, so its colour and size cannot change — that is what the receipt says was bought. Stock can still be edited.";
  }
  if (message.includes("violates foreign key")) {
    return "Something still refers to this — a Variant that has been sold cannot be deleted.";
  }
  if (message.includes("row-level security")) {
    return "The database refused that write. Are you still signed in as an admin?";
  }
  return message;
}

// ---------------------------------------------------------------------------
// The colour palette (#83)
// ---------------------------------------------------------------------------
//
// Lives here rather than in its own module because it is the same consumer,
// the same client and the same error translation as the rest of the catalog
// admin. The storefront never reads this table directly -- the hex reaches it
// as `color_hex` on `variants_available`, so lib/catalog.ts needs nothing from
// here.

export type PaletteColor = {
  name: string;
  hex: string;
  /**
   * How many Variants use this colour. Zero is what makes delete safe to
   * offer: `variants_color_fkey` is ON DELETE RESTRICT, so a colour in use
   * cannot be removed, and a button that only fails on submit is worse than no
   * button.
   */
  variantCount: number;
};

/**
 * The whole palette, alphabetically, with usage counts.
 *
 * `variants(count)` is a PostgREST aggregate over the foreign key, so the row
 * count comes back without the rows themselves. Both the palette page and the
 * Variant dropdowns on the Product editor read this one function -- the
 * dropdowns ignore the counts, which is cheaper than a second query shape to
 * keep in step.
 */
export async function getPalette(): Promise<PaletteColor[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("colors")
    .select("name, hex, variants(count)")
    .order("name");

  if (error) throw new Error(`Failed to load the colour palette: ${error.message}`);

  type RawColor = { name: string; hex: string; variants: { count: number }[] };

  return (data as unknown as RawColor[]).map((row) => ({
    name: row.name,
    hex: row.hex,
    variantCount: row.variants?.[0]?.count ?? 0,
  }));
}

export type ColorFields = { name: string; hex: string };

/**
 * FormData to ColorFields, validating what the database cannot say for itself
 * and what a native colour input cannot be trusted to have said.
 *
 * `<input type="color">` always submits `#rrggbb` in lowercase, so in a browser
 * this never fires. A Server Action is a POST endpoint anyone can hit, though,
 * and `colors_hex_check` refusing the write is a worse message than this one.
 * Uppercase is accepted and preserved: the CHECK allows either case, and
 * rewriting what the client typed is not this function's job.
 */
export function parseColorForm(form: FormData): ColorFields | { error: string } {
  const name = String(form.get("name") ?? "").trim();
  const hex = String(form.get("hex") ?? "").trim();

  if (name === "") return { error: "A colour needs a name." };
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return { error: "A colour needs a hex code like #8C947D." };
  }

  return { name, hex };
}

export async function createColor(fields: ColorFields): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("colors").insert(fields);
  return error ? writeError(error.message) : null;
}

/**
 * Renames a colour and/or changes its hex, in one statement.
 *
 * A rename is an UPDATE of the primary key, which `variants_color_fkey`
 * cascades to every Variant using it -- including Variants that have sold. That
 * is deliberate and is why the freeze in #84 exempts the cascade: a rename
 * changes what a shade is called, not which shade was bought.
 */
export async function updateColor(
  originalName: string,
  fields: ColorFields,
): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("colors").update(fields).eq("name", originalName);
  return error ? writeError(error.message) : null;
}

/**
 * Removes a colour from the palette.
 *
 * The page only offers this at zero usage, but the check is not repeated here:
 * `variants_color_fkey` is ON DELETE RESTRICT, so the database refuses a
 * colour that is in use whatever the caller believed, and `writeError` turns
 * that into a sentence. A count read here would be a second answer to a
 * question the constraint already answers atomically.
 */
export async function deleteColor(name: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("colors").delete().eq("name", name);
  return error ? writeError(error.message) : null;
}
