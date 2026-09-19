import type { MetadataRoute } from "next";
import { getProducts } from "@/lib/catalog";
import { SITE_URL } from "@/lib/site";

/**
 * sitemap.xml, via Next's file convention.
 *
 * Dynamic because it reads the catalog, and lib/catalog.ts reaches `next/headers`
 * through the Supabase server client -- there is no request scope during static
 * generation, so this would fail the build as a static route. Recomputing it per
 * crawl is not a cost worth optimising: crawlers fetch it rarely, and a sitemap
 * that lags the catalog is the exact failure it exists to prevent.
 *
 * It calls getProducts() rather than a narrower slug query, so the catalog keeps
 * exactly one door (CLAUDE.md). That embeds each Product's Variants for a list
 * that only needs slugs; if the real catalog (#5) makes that wasteful, the fix
 * is a `getCatalogSlugs()` in lib/catalog.ts, not a second query written here.
 *
 * Hidden Products are excluded by RLS, so nothing here filters them -- the same
 * reason lib/catalog.ts does not.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getProducts();

  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/catalog`, changeFrequency: "daily", priority: 0.8 },
    ...products.map((product) => ({
      url: `${SITE_URL}/catalog/${product.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
