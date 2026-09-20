import Link from "next/link";
import { getAdminProducts } from "@/lib/admin-catalog";
import { money } from "@/lib/orders";
import { createProductAction } from "./actions";

/**
 * Every Product, Hidden ones included. Per ADR 0007 (amended 2026-09-19).
 *
 * Hidden Products appear here because `products_select_visible` is
 * `not is_hidden or private.is_admin()` — the same query returns the whole
 * catalog to an admin and the visible part to a shopper. There is no
 * `is_hidden` filter in this page to get wrong.
 *
 * Creating a Product asks for the three fields that have no sensible default
 * and sends you straight to the editor. A Product with no Variants and no
 * images is not finished, and this list cannot fix either.
 */

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const { error, deleted } = await searchParams;
  const products = await getAdminProducts();

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-8">
        <h2 className="font-cinzel text-2xl">Products</h2>
        <p className="font-belleza text-sm text-ssuni-slate">
          {products.length} {products.length === 1 ? "product" : "products"}
        </p>
      </div>

      {error && (
        <p role="alert" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-brown bg-ssuni-light2">
          {error}
        </p>
      )}
      {deleted && !error && (
        <p role="status" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-sage bg-ssuni-sage/10">
          Product deleted.
        </p>
      )}

      <form
        action={createProductAction}
        className="flex flex-wrap items-end gap-3 border border-ssuni-light2 p-5 mb-10"
      >
        <Field label="Name" name="name" placeholder="Rabbit Hole Hoodie" required grow />
        <Field label="URL slug" name="slug" placeholder="rabbit-hole-hoodie" required grow />
        <Field label="Price" name="price" type="number" step="0.01" min="0" placeholder="65.00" />
        {/* New Products start Hidden. The client is creating one before its
            photography and stock exist, and a half-built Product on the live
            storefront is worse than one nobody can find yet. */}
        <input type="hidden" name="isHidden" value="on" />
        <button
          type="submit"
          className="bg-ssuni-brown text-ssuni-light1 px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-slate transition-colors cursor-pointer"
        >
          Add product
        </button>
        <p className="font-belleza text-xs text-ssuni-slate basis-full">
          Created Hidden, so nothing appears on the shop until you say so.
        </p>
      </form>

      {products.length === 0 ? (
        <p className="font-belleza text-ssuni-slate border-t border-ssuni-light2 pt-10">
          No products yet.
        </p>
      ) : (
        <ul className="border-t border-ssuni-light2">
          {products.map((p) => (
            <li key={p.id} className="border-b border-ssuni-light2">
              <Link
                href={`/admin/products/${p.id}`}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5 hover:opacity-70 transition-opacity"
              >
                <span>
                  <span className="font-belleza text-ssuni-brown">
                    {p.name}
                    {p.isHidden && (
                      <span className="ml-3 text-xs uppercase tracking-widest text-ssuni-slate">
                        Hidden
                      </span>
                    )}
                  </span>
                  <span className="font-belleza block text-sm text-ssuni-slate">
                    /{p.slug} · {p.variantCount}{" "}
                    {p.variantCount === 1 ? "variant" : "variants"} · {p.imageCount}{" "}
                    {p.imageCount === 1 ? "image" : "images"}
                    {/* The two states that make a Product unsellable or
                        unbrowsable, called out rather than left to arithmetic. */}
                    {p.variantCount === 0 && " · nothing to buy"}
                    {p.imageCount === 0 && " · no photo"}
                  </span>
                </span>
                <span className="font-belleza text-ssuni-brown">{money(p.price)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  grow,
  ...input
}: {
  label: string;
  name: string;
  grow?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`flex flex-col gap-1 ${grow ? "grow min-w-[12rem]" : ""}`}>
      <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
        {label}
      </span>
      <input
        name={name}
        {...input}
        className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm"
      />
    </label>
  );
}
