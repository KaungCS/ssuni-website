import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProductGrid from "@/components/ProductGrid";
import {
  getProducts,
  hasActiveFilters,
  parseCatalogFilters,
  type CatalogFilters,
} from "@/lib/catalog";
import { categoryLabel, collectionLabel, departmentLabel } from "@/lib/taxonomy";

// Fully dynamic on purpose: stock changes, and a cached "Few Left" badge is a
// lie told to a paying customer. The catalog is placeholder seed data today
// (#5) -- do not size this decision on the current row count. Once the client
// loads a real catalog and traffic is non-trivial, revisit: `export const
// revalidate = 60` here, plus OpenNext's KV incremental cache in
// open-next.config.ts, is the upgrade path.
//
// Reading searchParams would force dynamic rendering anyway, so #10's filters
// cost nothing extra here.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The active filters as display labels, in the order a shopper narrows: broadest
 * dimension first. Empty when nothing is filtered.
 */
function activeLabels(filters: CatalogFilters): string[] {
  return [
    ...filters.departments.map(departmentLabel),
    ...filters.categories.map(categoryLabel),
    ...filters.collections.map(collectionLabel),
    ...(filters.isNew ? ["New Arrivals"] : []),
  ];
}

/**
 * One filter names the page ("Knitwear & Sweaters"). Several don't compose into
 * a headline, so the heading stays "Shop All" and the subtitle lists them.
 */
function headingFor(labels: string[]): string {
  return labels.length === 1 ? labels[0] : "Shop All";
}

/**
 * A filtered view is a different page as far as a bookmark, a shared link, or a
 * browser tab is concerned, so the title has to say which one it is.
 *
 * This re-parses the same params the page parses. That is deliberate and free --
 * validation touches no database, and threading the result through would mean
 * inventing a cache for something cheaper than the cache.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const filters = parseCatalogFilters(await searchParams);
  if (!filters) return { title: "Not Found | SSUNI" };

  const labels = activeLabels(filters);
  const title = labels.length > 0 ? labels.join(" · ") : "Shop All";

  return { title: `${title} | SSUNI` };
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const filters = parseCatalogFilters(await searchParams);

  // A URL naming a category that does not exist is a real 404, the same way an
  // unknown Product slug is. Rendering the whole catalog instead would quietly
  // ignore what the shopper asked for; rendering an empty state would imply the
  // category is real and temporarily bare. Note that individual unknown values
  // are dropped rather than fatal -- see parseCatalogFilters.
  if (!filters) notFound();

  const products = await getProducts(filters);
  const labels = activeLabels(filters);
  const filtered = hasActiveFilters(filters);

  const subtitle =
    labels.length === 0
      ? "The complete collection."
      : labels.length === 1
        ? `${products.length} ${products.length === 1 ? "piece" : "pieces"}`
        : labels.join(" · ");

  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-7xl mx-auto px-6">

        {/* Page Header & Filter Utility Bar */}
        <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-ssuni-brown/20 pb-6 mb-12">
          <div>
            <h1 className="font-cinzel text-4xl md:text-5xl text-ssuni-brown mb-2">
              {headingFor(labels)}
            </h1>
            <p className="font-belleza text-stone-600 tracking-wide">
              {subtitle}
            </p>
          </div>

          <div className="mt-6 md:mt-0 flex items-center gap-6">
            {filtered && (
              <Link
                href="/catalog"
                className="font-belleza uppercase tracking-widest text-sm text-stone-500 hover:text-ssuni-brown transition-colors"
              >
                Clear filters
              </Link>
            )}
            {/* Inert until the filter and sort drawer lands in #37. */}
            <button className="font-belleza uppercase tracking-widest text-sm text-ssuni-brown hover:opacity-70 transition-opacity border-b border-ssuni-brown pb-1">
              Filter &amp; Sort +
            </button>
          </div>
        </div>

        {/* The Grid */}
        <ProductGrid products={products} />

      </div>
    </div>
  );
}
