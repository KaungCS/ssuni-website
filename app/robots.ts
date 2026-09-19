import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * robots.txt, via Next's file convention.
 *
 * The disallow list is about crawl waste and duplicate content, not security --
 * every one of these paths is already protected by RLS or an auth redirect, and
 * robots.txt is a request a crawler may ignore. /profile and /checkout redirect
 * signed-out visitors anyway; /cart is per-browser and identical-looking to a
 * crawler; /api returns JSON that has no business in an index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/cart", "/checkout/", "/profile"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
