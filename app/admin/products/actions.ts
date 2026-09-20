"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import {
  addImage,
  createProduct,
  deleteImage,
  deleteProduct,
  deleteVariant,
  parseProductForm,
  saveVariant,
  setImageOrder,
  updateProduct,
} from "@/lib/admin-catalog";

/**
 * Catalog writes for the Admin Dashboard.
 *
 * Every one of these calls `requireAdmin()` first, and that is not redundant
 * with app/admin/layout.tsx: a Server Action is a POST endpoint anyone can hit
 * directly, and the layout that rendered the form is not in its request path.
 * RLS would still refuse the write -- `products_admin_write` and friends are
 * the actual boundary (ADR 0004) -- but a 404 beats a confusing no-op.
 *
 * They are separate actions rather than one dispatcher taking a table name.
 * A generic write helper is exactly the shape that turns a form field into a
 * column nobody meant to expose; each of these names the columns it touches.
 *
 * Errors come back as a `?error=` query parameter, so these pages need no
 * client component and keep working with JavaScript off -- the same trade
 * CatalogFilterDrawer and /admin/orders make.
 */

function back(productId: string, message?: string): never {
  redirect(
    message
      ? `/admin/products/${productId}?error=${encodeURIComponent(message)}`
      : `/admin/products/${productId}?saved=1`,
  );
}

export async function createProductAction(formData: FormData) {
  await requireAdmin();

  const fields = parseProductForm(formData);
  if ("error" in fields) {
    redirect(`/admin/products?error=${encodeURIComponent(fields.error)}`);
  }

  const result = await createProduct(fields);
  if ("error" in result) {
    redirect(`/admin/products?error=${encodeURIComponent(result.error)}`);
  }

  // Straight into the editor: a Product with no Variants and no images is not
  // finished, and the list view cannot fix either.
  redirect(`/admin/products/${result.id}?saved=1`);
}

export async function updateProductAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("productId") ?? "");
  if (!id) redirect("/admin/products?error=Missing%20product");

  const fields = parseProductForm(formData);
  if ("error" in fields) back(id, fields.error);

  back(id, (await updateProduct(id, fields)) ?? undefined);
}

export async function deleteProductAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("productId") ?? "");
  if (!id) redirect("/admin/products?error=Missing%20product");

  const error = await deleteProduct(id);
  if (error) back(id, error);

  redirect("/admin/products?deleted=1");
}

export async function saveVariantAction(formData: FormData) {
  await requireAdmin();

  const productId = String(formData.get("productId") ?? "");
  if (!productId) redirect("/admin/products?error=Missing%20product");

  const variantId = String(formData.get("variantId") ?? "") || null;
  const color = String(formData.get("color") ?? "").trim();
  const size = String(formData.get("size") ?? "").trim();
  const rawStock = String(formData.get("stock") ?? "").trim();

  if (color === "" || size === "") back(productId, "A Variant needs both a colour and a size.");

  const stock = Number(rawStock);
  if (!Number.isInteger(stock) || stock < 0) {
    back(productId, "Stock must be a whole number, and not negative.");
  }

  back(productId, (await saveVariant(productId, variantId, color, size, stock)) ?? undefined);
}

export async function deleteVariantAction(formData: FormData) {
  await requireAdmin();

  const productId = String(formData.get("productId") ?? "");
  const variantId = String(formData.get("variantId") ?? "");
  if (!productId || !variantId) redirect("/admin/products?error=Missing%20variant");

  back(productId, (await deleteVariant(variantId)) ?? undefined);
}

/**
 * Records an image that the browser has *already* uploaded to Storage.
 *
 * The upload itself happens client-side in components/AdminImageUploader.tsx,
 * against the bucket's own RLS. Routing the bytes through a Server Action
 * would mean the file crossing the worker -- which on Cloudflare is a request
 * body limit and a memory cost for no security gain, since the bucket policy
 * is the boundary either way.
 */
export async function addImageAction(formData: FormData) {
  await requireAdmin();

  const productId = String(formData.get("productId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  if (!productId) redirect("/admin/products?error=Missing%20product");
  if (url === "") back(productId, "That upload produced no URL.");

  const sortOrder = Number(String(formData.get("sortOrder") ?? "0"));
  back(
    productId,
    (await addImage(productId, url, Number.isInteger(sortOrder) ? sortOrder : 0)) ?? undefined,
  );
}

export async function setImageOrderAction(formData: FormData) {
  await requireAdmin();

  const productId = String(formData.get("productId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  if (!productId || !imageId) redirect("/admin/products?error=Missing%20image");

  const sortOrder = Number(String(formData.get("sortOrder") ?? ""));
  if (!Number.isInteger(sortOrder)) back(productId, "Order must be a whole number.");

  back(productId, (await setImageOrder(imageId, sortOrder)) ?? undefined);
}

export async function deleteImageAction(formData: FormData) {
  await requireAdmin();

  const productId = String(formData.get("productId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  if (!productId || !imageId) redirect("/admin/products?error=Missing%20image");

  back(productId, (await deleteImage(imageId)) ?? undefined);
}
