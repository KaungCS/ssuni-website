import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminImageUploader from "@/components/AdminImageUploader";
import {
  getAdminProduct,
  getPalette,
  type AdminImage,
  type AdminVariant,
  type PaletteColor,
} from "@/lib/admin-catalog";
import {
  CATEGORIES,
  CATEGORY_SLUGS,
  COLLECTIONS,
  COLLECTION_SLUGS,
  DEPARTMENTS,
  DEPARTMENT_SLUGS,
} from "@/lib/taxonomy";
import {
  addImageAction,
  deleteImageAction,
  deleteProductAction,
  deleteVariantAction,
  saveVariantAction,
  setImageOrderAction,
  updateProductAction,
} from "../actions";

/**
 * One Product, in full. Per ADR 0007 (amended 2026-09-19).
 *
 * Taxonomy fields are selects built from lib/taxonomy.ts, so an undeclared term
 * cannot be typed and the SQL CHECK constraints behind them can never fire from
 * this page. That module is the *second consumer* of the vocabulary, not a
 * fourth copy of it — components/ShopDropdown.tsx already reads the same lists
 * (#51), which is why #49 stays parked.
 *
 * Every form is an uncontrolled <form> posting to a Server Action: no client
 * state, works with JavaScript off, and the saved result is the re-rendered
 * page. The one exception is the image uploader, because a file input has no
 * server-rendered equivalent.
 */

/** What a swatch falls back to when a colour row is missing -- Tailwind's gray-300, which is what the old hardcoded map rendered for an unknown colour. */
const FALLBACK_SWATCH = "#D1D5DB";

export default async function AdminProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;

  const product = await getAdminProduct(id);
  if (!product) notFound();

  // The Variant forms choose from the palette (#83) rather than accepting free
  // text, which is what keeps a storefront swatch the colour the client picked.
  const palette = await getPalette();

  return (
    <div>
      <Link
        href="/admin/products"
        className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors"
      >
        ← All products
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-4 mt-4 mb-8">
        <h2 className="font-cinzel text-2xl">{product.name}</h2>
        <Link
          href={`/catalog/${product.slug}`}
          className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors"
        >
          View on shop ↗
        </Link>
      </div>

      {error && (
        <p role="alert" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-brown bg-ssuni-light2">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-sage bg-ssuni-sage/10">
          Saved.
        </p>
      )}

      {/* ---- Details ---- */}
      <form action={updateProductAction} className="grid sm:grid-cols-2 gap-4 mb-12">
        <input type="hidden" name="productId" value={product.id} />

        <Field label="Name" name="name" defaultValue={product.name} required />
        <Field label="URL slug" name="slug" defaultValue={product.slug} required />
        <Field
          label="Price"
          name="price"
          type="number"
          step="0.01"
          min="0"
          defaultValue={product.price}
          required
        />

        <Select label="Department" name="department" value={product.department} options={DEPARTMENTS} slugs={DEPARTMENT_SLUGS} />
        <Select label="Category" name="category" value={product.category} options={CATEGORIES} slugs={CATEGORY_SLUGS} />

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
            Description
          </span>
          <textarea
            name="description"
            rows={4}
            defaultValue={product.description ?? ""}
            className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm"
          />
        </label>

        <fieldset className="sm:col-span-2">
          <legend className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate mb-2">
            Collections
          </legend>
          {/* Repeated checkboxes sharing one name — the same shape the catalog
              filter drawer emits, read back by form.getAll("collections"). */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {COLLECTION_SLUGS.map((slug) => (
              <label key={slug} className="flex items-center gap-2 font-belleza text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="collections"
                  value={slug}
                  defaultChecked={product.collections.includes(slug)}
                  className="cursor-pointer"
                />
                {COLLECTIONS[slug]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 font-belleza text-sm cursor-pointer">
            <input type="checkbox" name="isNew" defaultChecked={product.isNew} className="cursor-pointer" />
            New arrival
          </label>
          <label className="flex items-center gap-2 font-belleza text-sm cursor-pointer">
            <input type="checkbox" name="isHidden" defaultChecked={product.isHidden} className="cursor-pointer" />
            Hidden from the shop
          </label>
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            className="bg-ssuni-brown text-ssuni-light1 px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-slate transition-colors cursor-pointer"
          >
            Save details
          </button>
        </div>
      </form>

      {/* ---- Variants ---- */}
      <section className="mb-12">
        <h3 className="font-cinzel text-xl mb-2">Variants</h3>
        <p className="font-belleza text-sm text-ssuni-slate mb-5">
          <strong className="text-ssuni-brown">Stock</strong> is what is on your shelf.{" "}
          <strong className="text-ssuni-brown">Available</strong> is what the shop will
          sell — stock minus checkouts in progress. They differ while someone is paying,
          and that is normal.
        </p>

        {product.variants.length === 0 && (
          <p className="font-belleza text-sm text-ssuni-slate mb-5">
            No variants yet — nothing on this Product can be bought until there is one.
          </p>
        )}

        <ul className="mb-5">
          {product.variants.map((v) => (
            <VariantRow key={v.id} productId={product.id} variant={v} palette={palette} />
          ))}
        </ul>

        {palette.length === 0 ? (
          <p className="font-belleza text-sm text-ssuni-slate border border-ssuni-light2 p-5">
            Your palette is empty, so there is no colour to give a Variant.{" "}
            <Link href="/admin/colors" className="underline hover:text-ssuni-brown transition-colors">
              Add a colour first
            </Link>
            .
          </p>
        ) : (
          <form action={saveVariantAction} className="flex flex-wrap items-end gap-3 border border-ssuni-light2 p-5">
            <input type="hidden" name="productId" value={product.id} />
            <ColorSelect palette={palette} value={null} />
            <Field label="Size" name="size" placeholder="M" required />
            <Field label="Stock" name="stock" type="number" min="0" step="1" defaultValue={0} required />
            <button
              type="submit"
              className="border border-ssuni-brown px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors cursor-pointer"
            >
              Add variant
            </button>
          </form>
        )}
      </section>

      {/* ---- Images ---- */}
      <section className="mb-12">
        <h3 className="font-cinzel text-xl mb-2">Images</h3>
        <p className="font-belleza text-sm text-ssuni-slate mb-5">
          The lowest order number is the one shoppers see on the catalog grid.
        </p>

        {product.images.length === 0 && (
          <p className="font-belleza text-sm text-ssuni-slate mb-5">
            No images yet — the shop will show a placeholder.
          </p>
        )}

        <ul className="flex flex-wrap gap-5 mb-6">
          {product.images.map((image) => (
            <ImageCard key={image.id} productId={product.id} image={image} />
          ))}
        </ul>

        <AdminImageUploader
          pathPrefix={product.id}
          hiddenFields={{
            productId: product.id,
            // One past the last image, so a fresh upload lands at the end of
            // the gallery.
            sortOrder: String(
              product.images.length === 0
                ? 0
                : Math.max(...product.images.map((i) => i.sortOrder)) + 1,
            ),
          }}
          action={addImageAction}
        />
      </section>

      {/* ---- Danger ---- */}
      <section className="border-t border-ssuni-light2 pt-8">
        <h3 className="font-cinzel text-xl mb-2">Delete this product</h3>
        <p className="font-belleza text-sm text-ssuni-slate mb-4 max-w-xl">
          Removes it and its variants and images for good. If it has ever been bought,
          the database will refuse — a sale&apos;s record cannot be erased by tidying the
          catalog. <strong className="text-ssuni-brown">Hide it instead</strong> for
          anything you have stopped selling.
        </p>
        <form action={deleteProductAction}>
          <input type="hidden" name="productId" value={product.id} />
          <button
            type="submit"
            className="border border-ssuni-brown px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors cursor-pointer"
          >
            Delete product
          </button>
        </form>
      </section>
    </div>
  );
}

/**
 * One Variant.
 *
 * A Variant that has been ordered shows its colour and size as text with
 * hidden inputs carrying them, rather than as editable fields (#84). The
 * database refuses the change either way -- `freeze_sold_variant` is the rule,
 * because the client also edits in Supabase Studio -- but a field that accepts
 * a value and then loses it is a worse way to learn that than never offering
 * it. Stock stays editable: restocking says nothing about what was sold.
 */
function VariantRow({
  productId,
  variant,
  palette,
}: {
  productId: string;
  variant: AdminVariant;
  palette: PaletteColor[];
}) {
  // Held = the gap between the shelf and what the shop will sell. Shown only
  // when it is non-zero, so the common case stays quiet.
  const held = variant.stock - variant.availableStock;

  return (
    <li className="flex flex-wrap items-end gap-3 border-b border-ssuni-light2 py-4">
      <form action={saveVariantAction} className="flex flex-wrap items-end gap-3 grow">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="variantId" value={variant.id} />

        {variant.hasOrders ? (
          <>
            <input type="hidden" name="color" value={variant.color} />
            <input type="hidden" name="size" value={variant.size} />
            <p className="font-belleza text-sm pb-2 flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block w-3.5 h-3.5 rounded-full border border-black/10"
                style={{ backgroundColor: variant.colorHex ?? FALLBACK_SWATCH }}
              />
              {variant.color} · {variant.size}
            </p>
          </>
        ) : (
          <>
            <ColorSelect palette={palette} value={variant.color} />
            <Field label="Size" name="size" defaultValue={variant.size} required />
          </>
        )}

        <Field label="Stock" name="stock" type="number" min="0" step="1" defaultValue={variant.stock} required />

        <p className="font-belleza text-sm text-ssuni-slate pb-2">
          Available: <span className="text-ssuni-brown">{variant.availableStock}</span>
          {held > 0 && ` (${held} in checkout)`}
        </p>

        <button
          type="submit"
          className="border border-ssuni-light2 px-4 py-2 font-belleza uppercase tracking-widest text-xs hover:border-ssuni-brown transition-colors cursor-pointer"
        >
          Save
        </button>
      </form>

      {variant.hasOrders ? (
        <p className="font-belleza text-xs text-ssuni-slate pb-2.5 max-w-xs">
          Ordered — colour and size are locked, and it cannot be removed. They are what
          the receipt says was bought.
        </p>
      ) : (
        <form action={deleteVariantAction}>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="variantId" value={variant.id} />
          <button
            type="submit"
            className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors pb-2.5 cursor-pointer"
          >
            Remove
          </button>
        </form>
      )}
    </li>
  );
}

/**
 * The Variant colour picker: the palette (#83) and nothing else, so
 * `variants_color_fkey` is a backstop here rather than something the client
 * meets. `value` is null on the add form, where the first colour is as good a
 * default as any.
 */
function ColorSelect({ palette, value }: { palette: PaletteColor[]; value: string | null }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
        Colour
      </span>
      <select
        name="color"
        defaultValue={value ?? palette[0]?.name ?? ""}
        required
        className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm cursor-pointer"
      >
        {palette.map((color) => (
          <option key={color.name} value={color.name}>
            {color.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImageCard({ productId, image }: { productId: string; image: AdminImage }) {
  return (
    <li className="w-36">
      <div className="relative w-full aspect-[3/4] bg-ssuni-light2 overflow-hidden mb-2">
        <Image src={image.url} alt="" fill sizes="144px" className="object-cover" />
      </div>

      <form action={setImageOrderAction} className="flex items-center gap-2 mb-1">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="imageId" value={image.id} />
        <input
          type="number"
          name="sortOrder"
          step="1"
          defaultValue={image.sortOrder}
          aria-label="Display order"
          className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-2 py-1 text-sm w-16"
        />
        <button
          type="submit"
          className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors cursor-pointer"
        >
          Order
        </button>
      </form>

      <form action={deleteImageAction}>
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="imageId" value={image.id} />
        <button
          type="submit"
          className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors cursor-pointer"
        >
          Remove
        </button>
      </form>
    </li>
  );
}

function Field({
  label,
  name,
  ...input
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
        {label}
      </span>
      <input
        name={name}
        {...input}
        className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm w-full"
      />
    </label>
  );
}

/**
 * A taxonomy select. Options come from lib/taxonomy.ts and nowhere else, so the
 * only values this form can submit are declared ones — the CHECK constraints
 * behind these columns are a backstop here rather than a thing the client will
 * ever hit.
 */
function Select({
  label,
  name,
  value,
  options,
  slugs,
}: {
  label: string;
  name: string;
  value: string | null;
  options: Record<string, string>;
  slugs: readonly string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm cursor-pointer"
      >
        {/* Empty is a real choice: both columns are nullable, and the CHECKs
            are written `is null or in (...)`. */}
        <option value="">— none —</option>
        {slugs.map((slug) => (
          <option key={slug} value={slug}>
            {options[slug]}
          </option>
        ))}
      </select>
    </label>
  );
}
