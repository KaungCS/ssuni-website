/**
 * Site-level constants that are not per-request.
 *
 * `app/api/checkout/route.ts` derives its origin from the incoming request,
 * which is the right answer wherever a request exists. Metadata, the sitemap and
 * robots.txt have no request to read -- an Open Graph image URL has to be
 * absolute for a crawler that never saw ours -- so they need a configured value.
 */

/**
 * The public origin, no trailing slash.
 *
 * **`NEXT_PUBLIC_SITE_URL` must be set as a Cloudflare BUILD variable, not a
 * Worker secret** (see the table in CLAUDE.md): Next inlines `NEXT_PUBLIC_*` at
 * build time, so setting it as a runtime secret leaves this on the fallback
 * below with a successful, silent build.
 *
 * The fallback is localhost rather than a guess at the production domain,
 * because a wrong absolute origin in a sitemap is worse than an obviously wrong
 * one: a sitemap full of a domain we do not own is a crawler instruction we
 * cannot retract, while localhost is self-evidently a misconfiguration the first
 * time anyone looks. Issue #27 buys the domain; set this in the same change.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

/**
 * Where a shopper writes to. **Placeholder** until the domain exists (#27).
 *
 * It is here rather than inline in the footer so that replacing it is one edit
 * in a file named after the thing, not a grep through JSX. Stripe's live-mode
 * account review (#26) looks for contact details on the site, so this has to be
 * real before that review, not before launch day.
 */
export const CONTACT_EMAIL = "hello@ssuni.example";
