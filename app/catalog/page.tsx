import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CatalogFilterDrawer from "@/components/CatalogFilterDrawer";
import ProductGrid from "@/components/ProductGrid";
import {
  catalogUrlKey,
  getCatalogFacets,
  getProducts,
  hasActiveFilters,
  parseCatalogFilters,
  parseCatalogSort,
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
 * What the shopper is looking at -- and nothing else. There is deliberately no
 * subtitle at exactly one filter, because headingFor() has already said it and
 * repeating it is noise.
 *
 * The item count used to live here, and only in the one-filter case, where it
 * was filling the space a redundant label would have occupied. That made a
 * counting feature look half-missing from the other two states. It now has its
 * own element in the utility bar, present at every filter state (#37).
 */
function subtitleFor(labels: string[]): string | null {
  if (labels.length === 0) return "The complete collection.";
  if (labels.length === 1) return null;
  return labels.join(" · ");
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
  const params = await searchParams;
  const filters = parseCatalogFilters(params);

  // A URL naming a category that does not exist is a real 404, the same way an
  // unknown Product slug is. Rendering the whole catalog instead would quietly
  // ignore what the shopper asked for; rendering an empty state would imply the
  // category is real and temporarily bare. Note that individual unknown values
  // are dropped rather than fatal -- see parseCatalogFilters.
  //
  // An unrecognised `?sort=` does NOT 404; it falls back. See parseCatalogSort
  // for why the two are treated differently.
  if (!filters) notFound();

  const sort = parseCatalogSort(params);

  // Independent reads, so pay for one round trip rather than two in series.
  const [products, facets] = await Promise.all([
    getProducts(filters, sort),
    getCatalogFacets(),
  ]);

  const labels = activeLabels(filters);
  const filtered = hasActiveFilters(filters);
  const subtitle = subtitleFor(labels);
  const count = `${products.length} ${products.length === 1 ? "piece" : "pieces"}`;

  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-7xl mx-auto px-6">

        {/* Page Header & Filter Utility Bar */}
        <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-ssuni-brown/20 pb-6 mb-12">
          <div>
            <h1 className="font-cinzel text-4xl md:text-5xl text-ssuni-brown mb-2">
              {headingFor(labels)}
            </h1>
            {subtitle && (
              <p className="font-belleza text-stone-600 tracking-wide">
                {subtitle}
              </p>
            )}
          </div>

          <div className="mt-6 md:mt-0 flex items-center gap-6">
            {/* Always present, at every filter state including none. */}
            <span className="font-belleza text-sm text-stone-500 tracking-wide">
              {count}
            </span>
            {filtered && (
              <Link
                href="/catalog"
                className="font-belleza uppercase tracking-widest text-sm text-stone-500 hover:text-ssuni-brown transition-colors"
              >
                Clear filters
              </Link>
            )}
            <CatalogFilterDrawer
              facets={facets}
              filters={filters}
              sort={sort}
              paramsKey={catalogUrlKey(filters, sort)}
            />
          </div>
        </div>

        {/* The Grid */}
        <ProductGrid products={products} />

      </div>
    </div>
  );
}
