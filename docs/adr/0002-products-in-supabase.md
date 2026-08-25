# Products and Variants move to Supabase

The catalog is currently static JSON (`data/products.json`), hand-edited via git/IDE, and the site is deploying to Vercel. A planned Admin Dashboard needs to let a non-technical client edit Product data directly from the deployed site — but Vercel's deployed filesystem is read-only at runtime, so a JSON file can't be edited from a live admin UI. We chose to move Product and Variant data into Supabase tables, queried by both the storefront and the Admin Dashboard, rather than introduce a second database — Supabase is already integrated for auth.

## Consequences

Requires a Supabase server-side client (none exists yet) and a real Product/Variant schema, increasing scope versus staying on JSON — but this is a hard prerequisite for the Admin Dashboard, one of the most important planned features.

## Later context (2026-08-24)

Both premises above have since moved, though the decision itself stands.

ADR 0005 replaced Vercel with Cloudflare Pages/Workers, so "Vercel's deployed filesystem is read-only at runtime" no longer names the actual host — the argument survives in substance, because a Workers deployment bundle is equally immutable at runtime. ADR 0007 then deferred the Admin Dashboard past the September launch, which removes the "hard prerequisite" framing that gave this ADR its urgency.

What now justifies the migration is narrower and more immediate: Orders, the Stripe webhook, and the RLS boundary of ADR 0004 all need a database regardless of when the Admin Dashboard ships, and a JSON file cannot participate in any of them. Reopening this ADR would mean reopening those, so it is not a live question — but a reader arriving at the original reasoning should know it is no longer the operative one.
