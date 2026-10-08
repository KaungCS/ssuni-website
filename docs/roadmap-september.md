# September Roadmap

> **Superseded 2026-10-07 — the deadline was dropped.** Launch now waits on the client-owned track below, and the plan of record is [handoff-2026-10-08.md](handoff-2026-10-08.md). This file is kept as history. Its **client track** and **never-cut list** still apply; its dates, freeze and cut order do not.

**Launch target: 2026-09-30 (hard).** Written 2026-08-24 — five and a half weeks, solo, ~15–20 hrs/week.

This roadmap sequences the work between the storefront as it exists today and a site that can legitimately take a real customer's money. It is dependency-ordered: each week's work unblocks the next. Terminology follows [CONTEXT.md](../CONTEXT.md).

## Where the code actually is

A front end over two hardcoded Products in `data/products.json`. Supabase is integrated for OTP login only — browser client, no server client, no database tables. `/cart` and `/profile` are linked from the nav and 404. The mega menu emits `?department=`, `?category=`, and `?collection=` that nothing reads. No Stripe, no deploy configuration.

## Scope decision: the Admin Dashboard waits

The Admin Dashboard is **not launch-blocking**. At launch the client manages Products and Hero Stories through Supabase Studio. Only a minimal **Orders-only** admin view ships in September — enough to fulfill a sale. See [ADR 0007](adr/0007-admin-dashboard-deferred.md).

---

## Week 1 — Aug 24–30: foundations and de-risking

Highest-unknown work first, while there is still time to change course.

- **Housekeeping.** Commit the untracked `CLAUDE.md`, `CONTEXT.md`, and `docs/`. Finish and commit the in-progress `components/HeroStory.tsx` change. Delete the stray empty nested `ssuni-website/` directory.
- **Deploy spike — do this first.** Stand up the app *as-is* on Cloudflare Pages via the OpenNext adapter ([ADR 0005](adr/0005-cloudflare-over-vercel.md)) and get a live preview URL. Next.js 16.3.1 on OpenNext/Cloudflare is the single biggest unvalidated assumption in this plan. If the adapter cannot run this app, that is a hosting decision to revisit in week 1, not week 6.
- **Supabase schema v1: `products` + `variants` + `reservations`.** Model on the existing JSON shape, plus the taxonomy columns the nav already links to (`department`, `category`, `collection`) and `is_hidden` for the Hidden/Archive concept. `reservations` and the Available Stock view come from [ADR 0010](adr/0010-reserve-stock-at-checkout.md). Seed from `data/products.json`.
- **RLS on both tables from the moment they are created** ([ADR 0004](adr/0004-supabase-rls-is-the-security-boundary.md)): public `select` where not Hidden, writes restricted to the admin-allowlisted user. The ADR is explicit that no table goes live with default-open or missing policies, even temporarily during development.
- **Surface the client-owned track** (below) — those items can hold the date regardless of code readiness.

## Week 2 — Aug 31–Sep 6: catalog reads from Supabase

Per [ADR 0002](adr/0002-products-in-supabase.md).

- **`lib/supabase/server.ts`** — a `createServerClient` companion to the browser client in `lib/supabase.ts`, plus `middleware.ts` for session refresh. Everything downstream needs it.
- **Convert the catalog to server components.** `app/catalog/page.tsx` and `app/catalog/[slug]/page.tsx` query Supabase instead of importing JSON; `components/ProductGrid.tsx` takes Products as props. The detail page's color/size/stock derivation logic is sound — keep it, change only the data source. Delete `data/products.json` once green.
- **Wire the taxonomy filters.** Read `?department=`, `?category=`, `?collection=`, `?filter=new` as `searchParams` and filter the query. Cheap once the data is in a database, and it removes a set of visibly-dead nav links. "Best Sellers" and "Fall Lookbook" become hand-curated Collections rather than computed rankings — see the Collection entry in `CONTEXT.md`.
- **Product images to Supabase Storage** ([ADR 0009](adr/0009-product-images-in-supabase-storage.md)), replacing the single `/images/download.jpeg` placeholder every Product currently shares.

## Week 3 — Sep 7–13: Cart and checkout

Per [ADR 0001](adr/0001-guest-local-cart.md) and [ADR 0008](adr/0008-stripe-hosted-checkout.md).

- **Cart provider** — React context persisted to `localStorage`, holding Variants. Strictly client-side, never account-bound. Wire the live count into the hardcoded `0` badge in `components/NavBar.tsx`.
- **`/cart` route**, and the Add to Cart button on the detail page (currently rendered but inert).
- **Stripe test-mode account** and `POST /api/checkout` creating a Checkout Session. Build prices dynamically from the Supabase Product rows (`price_data`) rather than mirroring a catalog into Stripe — one source of truth, no sync job.
- **Reserve stock at session creation** ([ADR 0010](adr/0010-reserve-stock-at-checkout.md)) — an atomic check-and-hold in a Postgres function, not a read-then-write from the route.
- **Login gate at checkout only.** The shopper reaches `app/login/page.tsx` on the way to payment, never before.

## Week 4 — Sep 14–20: Orders

- **`orders` + `order_items` schema + RLS.** A customer reads only their own Orders; nothing writes Order Status from the browser. `status` matches the glossary exactly: `Paid`, `Shipped`, `Delivered`, `Cancelled`, `Refunded`. `tracking_link` nullable.
- **Stripe webhook route** — verify the signature, handle `checkout.session.completed`, insert the Order as `Paid`, consume the Reservation and decrement `variants.stock` together, and make it idempotent (Stripe retries). Writes with the service role, not the anon key.
- **Reservation release** — handle `checkout.session.expired`, and make Available Stock ignore lapsed Reservations so a missed webhook can never strand inventory. Per ADR 0010 this is **about a day beyond the original week-4 budget**, taken deliberately; if week 4 runs long, the pressure lands on Hero Slots and the Orders admin below it in the cut order.
- **`/checkout/success`** and **`/profile`** — the Profile page shows the logged-in shopper their own Order history, Order Status, and Tracking Link.

## Week 5 — Sep 21–27: Orders admin, Hero Slots, legal

> **Amended 2026-09-19 — this week was pulled forward and its scope grew.** Weeks 1–4 finished early, so weeks 5–6 started during week 4. Hero Stories shipped early; the Orders-only admin became the full Admin Dashboard. The plan of record for what remains is [docs/superpowers/plans/2026-09-19-weeks-5-6-early.md](superpowers/plans/2026-09-19-weeks-5-6-early.md). The bullets below are kept as written, annotated.

- ~~**Orders-only admin**~~ → **the full Admin Dashboard.** Orders (list, mark `Shipped`, enter a Tracking Link) plus Products, Variants, Hero Stories and image upload, all gated on the admin allowlist. [ADR 0007](adr/0007-admin-dashboard-deferred.md) was amended on 2026-09-19 to lift the deferral: the write policies and grants for every one of those tables already existed and had never been consumed, so the cost was forms, not schema.
- ~~**Hero Slots**~~ → **done, and Slots no longer exist.** [ADR 0003](adr/0003-hero-story-slots.md) was amended on 2026-09-18 to replace fixed Slots with an unbounded ordered list, so `hero_stories` carries `sort_order` and `is_hidden` and no `slot` column. The landing page stacks every visible Story. Shipped in `c5016c5` (#22), a week early. Still fixed and manually curated, still no auto-rotation.
- **Product images** ([ADR 0009](adr/0009-product-images-in-supabase-storage.md), amended 2026-09-19) — slipped from week 2 and lands here instead, as an ordered `product_images` gallery rather than the single `image_url` the ADR originally described.
- **Legal pages** ([ADR 0006](adr/0006-legal-pages-timing-and-source.md)) — generate Privacy Policy, Terms, and Shipping & Returns from Termly or TermsFeed; add as static `/privacy`, `/terms`, `/shipping-returns`, deliberately not Admin-editable. The ADR defers generation to exactly this point so the policy describes the finished Supabase and Stripe data practices.

## Week 6 — Sep 28–30: launch

- **RLS audit** — walk every table against the ADR 0004 checklist. Hard gate.
- Mobile and responsive QA, empty states, 404 handling.
- Stripe **live mode** keys; real domain and DNS on Cloudflare; production env vars set in the Cloudflare dashboard (`.env.local` does not deploy).
- Client loads real Product content.
- **Smoke test: one complete real purchase with a real card**, end to end through fulfillment.

---

## Cut order

Decided now, while it is a calm decision. If the schedule slips, drop in this order:

1. Multi-slot Hero — keep the single hardcoded hero
2. Orders admin — client fulfills from Supabase Studio too
3. Catalog filtering — point every nav link at bare `/catalog`
4. Profile Order history — Stripe's own email receipts carry the customer

**Status 2026-09-19: nothing on this list was cut.** All four shipped — 3 in `#10`/`#37`, 4 in `#20`, 1 in `#22`, and 2 is in progress as the full Admin Dashboard rather than the reduced version. The list stays as written because it is a record of a decision made while calm, and because the schedule can still slip: if it does, the client-owned track below is what will have caused it, and none of these four cuts would buy back a single day against it.

**Never cut:** RLS policies, legal pages, webhook correctness and idempotency, the live-mode smoke test.

## Client-owned track

Blocks launch, is not code. Any one of these can hold the date regardless of code readiness — start them in week 1.

- Real product photography
- Product copy, pricing, and stock counts
- Business entity and bank account for Stripe payouts
- Shipping rates and returns terms, as inputs to the policy generator
- Domain purchase

## Tracking

Work items live as GitHub issues under the **September Launch** milestone (due 2026-09-30) in `KaungCS/ssuni-website`, one issue per bullet above. See [docs/agents/issue-tracker.md](agents/issue-tracker.md).
