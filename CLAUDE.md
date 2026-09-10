# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Canary

As to make sure the current session is still reading instructions properly, I want the responses of claude code to start with my name. For example: "Okay, Kaung ...", "Got it, Kaung, ...", "Done, Kaung, ..."

## Commands

```bash
npm run dev      # start dev server (Next.js, localhost:3000)
npm run build    # production build
npm run start    # run production build
npm run lint     # eslint (flat config, eslint-config-next)
npm test         # vitest, run once
npm run test:watch

npm run cf:build    # bundle a Cloudflare worker via OpenNext
npm run cf:preview  # build + serve the worker on the real workerd runtime
npm run cf:deploy   # build + deploy to Cloudflare
npm run cf:typegen  # regenerate cloudflare-env.d.ts from wrangler.jsonc

npm run db:push     # apply supabase/migrations to the linked project
npm run db:verify   # RLS suite + admin-path suite + Supabase security advisor
npm run db:types    # regenerate lib/database.types.ts from the linked schema
```

**Run `npm run db:types` after every migration and commit the result.** `lib/database.types.ts` is generated, never hand-edited; queries are typed against it, so a stale file produces confident-looking types that no longer match the database.

`npm run db:verify` is the schema's test suite and should be green before any PR that touches `supabase/`. It writes nothing permanent (the Reservation it creates is deleted; the admin-path SQL runs inside a transaction that rolls back), so it is safe against production. The advisor's only expected findings are `rls_auto_enable` ×2 — a Supabase platform event trigger, not RPC-callable — and leaked-password protection, which is moot while auth is email-OTP only. **Anything else the advisor reports is a real finding.** Extend `supabase/tests/rls.mjs` as tables are added, so the #24 RLS audit is a re-run rather than a manual walk.

**Do not run `npm run build`, `npm run cf:build` or `npm run cf:preview` while `npm run dev` is running.** They rewrite `.next`, which the dev server is reading from live, and it starts serving half-overwritten chunks: individual routes return 500 while others stay fine, and the log shows Next worker crashes ("Jest worker encountered N child process exceptions") rather than anything resembling the real problem. It looks exactly like a bug in whatever you last edited. Recovery: stop the dev server, `rm -rf .next`, restart. On Windows, confirm it actually died — killing the `npm` wrapper often leaves the `node` child holding port 3000, and that orphan is what gets corrupted. Hit 2026-08-26; cost more debugging time than the feature it masked.

`npm run lint` should report **6 warnings, 0 errors** (all `<img>`-vs-`next/image`, tracked in issue #11). If it reports thousands, a build-output directory has escaped the ignore list in `eslint.config.mjs` — the patterns are deliberately unanchored (`**/.next/**`, `**/.open-next/**`, …) because root-anchored ones missed a nested build dir once and buried the real findings 800:1. **Add any new build/output directory to both `eslint.config.mjs` and `.gitignore`.**

**After any `npm install` that changes `package-lock.json`, regenerate the lockfile with npm 10 before pushing — and do it after the *last* install, not the first:**

```bash
rm package-lock.json && npx npm@10.9.2 install --package-lock-only
```

**The `rm` is required.** With a `package-lock.json` already present, npm 10 now dies with `Cannot read properties of null (reading 'edgesOut')` — reproduced 2026-09-09 under Node 24 *and* a clean Node 22 (npm 10.9.3), with and without `node_modules`. The older recipe without the `rm` no longer works.

**Regenerating once in the middle of a session is worthless.** Every subsequent `npm install` under npm 11 re-prunes the lockfile. On 2026-09-09 the lockfile was correctly regenerated, then two more installs silently undid it, and the remote build failed at `npm clean-install` with *"Missing: `@emnapi/runtime` from lock file"* — before touching a line of app code. **Verify, don't assume:**

```bash
npm ci --dry-run          # must exit 0 under npm 11
# and under npm 10, which is what Cloudflare runs
```

**This machine is `arm64` (Windows on ARM)** — `node -e "console.log(process.arch)"` says so. Cloudflare builds on **x64 Linux**. So local installs resolve a different set of optional per-platform native binaries than the remote needs, which is the root of this entire class of failure and also why an unsigned ARM64 `@ast-grep/napi` once got blocked by Application Control (below).

**Dependencies carrying many optional per-platform binaries are the danger.** `vitest` is pinned to **3.x deliberately**: vitest 4 pulls vite 8, and with it `rolldown` and `esbuild@0.28`, whose optional binary sets npm 10 and npm 11 resolve differently — which breaks the shared lockfile outright. A lockfile npm 10 resolves from scratch is then rejected by npm 11, and merging the two is rejected by both. **Do not upgrade vitest to 4 without re-verifying `npm ci --dry-run` under both npm versions.**

Cloudflare's build image runs **npm 10.9.2** and there is no way to change it — `NODE_VERSION`, `.nvmrc` and `.node-version` set the Node version, and `YARN_VERSION` / `PNPM_VERSION` exist, but npm has no equivalent override. Local npm 11 prunes two optional transitive entries (`@emnapi/runtime` and `@emnapi/core`, reached through `@img/sharp-wasm32` → `sharp` → Next.js), and npm 10's `npm ci` then refuses the lockfile outright: *"can only install packages when your package.json and package-lock.json are in sync"*. The remote build fails during dependency install, before it ever reaches the app, so nothing in the error points at this repo.

A lockfile generated by npm 10 satisfies **both** versions — `npm ci` passes on 10.9.2 and 11.6.2, and `ci` never rewrites it. Only `npm install` under npm 11 re-prunes it. Verified 2026-08-30 after a remote build failed this way.

**Vitest 3 landed with the Cart provider (#12)** — pinned to 3.x for lockfile reasons; see the npm section above. It runs `node`-only by default and covers `lib/cart.ts`, plus exactly one jsdom file for the Cart's hydration; `vitest.config.ts` explains why the DOM environment is opted into per-file rather than switched on globally. **The checkout route (#15) and the Stripe webhook (#18, #30) extend this suite rather than starting their own** — those, with Cart math, are the whole of what issue #32 requires tests for. Presentational components stay exempt: see the workflow below, and #32 for why the scope is deliberately narrow.

## Development workflow

- **Write test cases before implementation — for the logic that can lose money.** Decided 2026-08-25 (issue #32). TDD is **required** for: Cart totals and quantity math (#12), the reservation check-and-hold RPC (#15, ADR 0010), and Stripe webhook handling and idempotency (#18, #30). For those, write the failing test(s) first, confirm they fail for the right reason, then implement until they pass — use the `tdd` skill (`mattpocock-skills:tdd`).

  Everything else — presentational components, layout, styling, catalog rendering — is **exempt**, and writing tests for it before the September launch is out of scope, not an oversight. The rule is narrow on purpose: against ~90–115 total hours, correctness on retries and race conditions is worth the time and snapshot-testing a hero banner is not.

  Database schema is verified by querying the real database (RLS proved with an actual anon client), not by unit tests.

## Project state — read this before planning anything

SSUNI is building toward a **hard end-of-September 2026 launch**, solo, at ~15–20 hrs/week. That deadline is the binding constraint on nearly every decision in this repo, and several ADRs cite it explicitly as the reason a simpler option was chosen.

**`docs/roadmap-september.md` is the plan of record.** It sequences the work week by week, names a pre-decided cut order for when the schedule slips, and lists a client-owned track (product photography, Stripe entity verification, domain purchase) that can hold the launch date with all the code finished. Read it before proposing work, and prefer picking up an existing issue over inventing new scope.

Much of what the Architecture section below describes is **scheduled to be replaced**, not preserved — see the roadmap and the issues before "improving" any of it.

**The catalog in the database is placeholder seed data (issue #5), not the real catalog.** It was seeded from the old `data/products.json` and has grown since — the client adds Products in Supabase Studio between sessions, loads real photography, copy, pricing and stock counts before launch, and the real catalog will be substantially larger. **Never justify a decision with the current row count** — no "there are only two products, so caching/pagination/indexing doesn't matter." Size decisions for a real storefront catalog.

**No test may assert an exact catalog row count.** Assert a floor (`>= 2`), a baseline captured at runtime, or — best — the property itself: "the Hidden Product vanished", not "one Product is left". This is not hypothetical tidiness. On 2026-08-30 a third Product appeared in the database between sessions and six exact-count assertions across `supabase/tests/rls.mjs` and `supabase/tests/admin-path.sql` failed at once, none of them describing a real problem. Extend the suites the same way as tables are added.

## Architecture

Next.js 16 App Router site (React 19, TypeScript, Tailwind CSS v4) for SSUNI, a clothing storefront.

- **`app/`** — routes. `app/page.tsx` (home), `app/catalog/page.tsx` (server-rendered grid), `app/catalog/[slug]/page.tsx` (server component that fetches one Product and calls `notFound()`, delegating the interactive color/size selection to `components/ProductDetail.tsx`), `app/login/page.tsx` (Supabase email-OTP auth flow), `app/not-found.tsx` (branded 404).
- **`components/`** — `NavBar.tsx` + `ShopDropdown.tsx` form the sticky header and hover-triggered mega menu. Menu links carry `?department=`, `?category=`, `?collection=`, and `?new=true`, all of which `catalog/page.tsx` reads (#10). **There is no `?filter=` param** — `?filter=best-sellers` and `?filter=lookbook` became `?collection=` links, because Best Sellers and Fall Lookbook are hand-curated Collections rather than computed rankings (`CONTEXT.md`). `CatalogFilterDrawer.tsx` is the in-page filter and sort drawer behind the "Filter & Sort +" button (#37) — a right-side slide-over at every breakpoint. It is a **`next/form` GET form, not a controlled React form**: checkboxes sharing a `name` emit the repeated params `parseCatalogFilters` already reads, `defaultChecked` comes from the server-parsed filters, and the only client state is open/closed, so it works with JS disabled. Two traps live in it — **a GET form replaces the whole query string**, so every param the drawer does not render a field for is dropped on Apply (hence the visible New Arrivals checkbox rather than a hidden input); and the form is **keyed on the current search params**, without which ticks abandoned by closing the drawer survive into the next open. Filters apply on an explicit Apply press, never per tick: catalog pages are `force-dynamic`, so instant-apply would spend a Supabase round trip per checkbox. `ProductGrid.tsx` renders the catalog grid from a `products` prop. `ProductDetail.tsx` is the client half of the detail page. `HeroStory.tsx` is the full-bleed home page hero.
- **`lib/catalog.ts`** — the only place the storefront queries the catalog. `getProducts(filters, sort)` and `getProductBySlug()` return a `CatalogProduct` with its Variants embedded, in one round trip (PostgREST embeds the `variants_available` view under `products`). Variants come from **`variants_available`, never `variants.stock`** — the raw column is the shelf count and ignores Reservations, so rendering it oversells (ADR 0010). `getCatalogFacets()` reads the `catalog_facets` view for the terms that currently have Products, which is what the drawer offers instead of the full declared vocabulary. New catalog surfaces extend this module rather than writing their own query.

  **This module can never be imported by a client component.** It reaches `next/headers` through `lib/supabase/server.ts`, so a `"use client"` file importing any runtime value from it fails the build with *"You're importing a module that depends on next/headers"*. Type-only imports are erased and are fine; a single value import is not.

- **`lib/cart.ts`** — the Cart's money and quantity math, as pure functions. Imports nothing: availability arrives as a plain argument, so every rule about what a shopper is charged is testable without a browser or a database. **The subtotal is computed here and nowhere else** — a second implementation in a component is how `/cart` and checkout come to disagree about a price. A **Cart Item** is `{variantId, quantity}` and never stores a price (ADR 0001, amended 2026-09-08): checkout builds Stripe `price_data` from live Supabase rows (ADR 0008), so a stored price would let the Cart display one number while Stripe charges another. Money is summed in **integer cents** — `19.99 * 3` is `59.97000000000001` in binary floating point, and that tail would reach both the shopper's screen and the amount charged.

  A Variant absent from the availability map is reported `unavailable`, which is not an edge case: `variants_available` ends in `where not p.is_hidden`, so the client hiding a Product in Supabase Studio drops its Variants from the view. Such a row **stays visible and out of the subtotal rather than being deleted** — the Cart never silently mutates itself. None of this is a correctness gate; the atomic check-and-hold of ADR 0010 (#15) is the only authority on whether stock can actually be sold.

- **`components/CartProvider.tsx`** — reads `localStorage` through **`useSyncExternalStore`, not a load effect plus a save-on-change effect**. That obvious shape has a bug: the save effect also runs on mount with the empty initial state and writes `[]` over the shopper's stored Cart. The final contents recover a moment later, so asserting on them proves nothing — the damage is the transient write, which another tab or a reload landing in that window reads and keeps. Reading through an external store removes the bug by construction and gives cross-tab sync for free. `components/CartProvider.test.tsx` records every write to the Cart key and fails if any is an empty Cart; it is the only jsdom test in the repo.

- **`app/api/cart/resolve/route.ts`** — `POST`, never `GET`. The response carries live prices and Available Stock, and a cacheable response is a stale-price bug. It returns **facts and never verdicts**, so it holds no logic — even its input validation is `parseResolveRequest` in `lib/cart.ts`, which is what keeps it covered by the pure test seam and caps how many ids one request can turn into a Supabase `.in()` filter.

- **`lib/catalog-url.ts`** — what a catalog URL *means*, split out of `lib/catalog.ts` precisely so the drawer can import it. **Pure: it imports nothing at all** (#50) — the declared vocabulary arrives as an argument rather than being read from a module, so no future source of Terms can drag `next/headers` back in through the side door. `lib/catalog.ts` re-exports all of it, so server-side callers keep treating `@/lib/catalog` as the single door; client components must import from `@/lib/catalog-url` directly.

  `parseCatalogFilters()` validates search params once, at the URL boundary, so nothing downstream re-validates. Dimensions combine with AND, values within a dimension with OR. A dimension whose values are *all* undeclared returns `null` and the page 404s; an individual unknown value alongside a valid one is dropped instead. **"Declared" means present in the `CatalogVocabulary` the caller passes in**, and nothing else — the function has no opinion about which Terms the shop sells, which is what lets #49 move that list into Postgres without touching a rule here. Filtering and sorting both run in Postgres against the existing indexes — never fetch-then-filter in JS.

  `parseCatalogSort()` reads `?sort=` (`newest` — the default — `price-asc`, `price-desc`) and **falls back rather than 404ing** on an unrecognised value. That asymmetry with `parseCatalogFilters` is deliberate: a dimension says *what you are looking at*, so ignoring it silently shows the wrong Products, while sort says *what order* and a fallback still shows the right ones. `?sort=newest` is accepted and identical to no param — the drawer's radio group always submits, so Apply on a bare catalog produces exactly that URL. **There is no "Featured" sort**: #37 defined it as the existing `created_at desc`, which is what Newest already is, so the menu would have carried two labels for one ordering. Curation lives in Collections (`CONTEXT.md`); a merchandised top-of-catalog would be a `featured_rank` column, not a Collection doing double duty.
- **`lib/taxonomy.ts`** — the declared vocabulary (slugs → display labels) for Department, Category, and Collection. **Its lists are duplicated as `CHECK` constraints in `supabase/migrations/20260830120000_taxonomy_declared_values.sql` and must be changed together**, or a term added to one and not the other fails in opposite directions: storefront-only gives a filter no Product can hold, database-only gives a valid Product that 404s. Issue #49 collapses this into real tables with foreign keys and removes the duplication; see ADR 0011 and ADR 0013. (Issue #38 was the earlier framing of the same work and is closed as superseded.) Note the vocabulary is duplicated in a **third** place neither ADR mentioned until 0013: `components/ShopDropdown.tsx` hardcodes all thirteen menu links with their labels, which issue #51 fixes.
- **`lib/database.types.ts`** — generated by `npm run db:types`. Do not hand-edit. Note that view columns (`variants_available`) come out nullable because Postgres views carry no NOT NULL constraints; `lib/catalog.ts` normalises them so components never see `number | null` stock.
- **`middleware.ts`** — session refresh on every request, matching everything except static assets. Removing this file does not break the build, it silently breaks session persistence, because `lib/supabase/server.ts` swallows the cookie-write error that Server Components always throw.

  **`npm run build` prints a deprecation warning telling you to rename this to `proxy.ts`. Do not do it.** A Proxy file is forced onto the Node.js runtime — Next.js rejects route segment config there with "Proxy always runs on Node.js runtime" — and `@opennextjs/cloudflare` refuses to bundle Node middleware ("Node.js middleware is not currently supported. Consider switching to Edge Middleware."). The rename passes `npm run build` and then **fails `npm run cf:preview`**, which is the runtime this site actually deploys to. Verified both ways on 2026-08-26: as `middleware.ts` the build emits edge middleware (`middleware["/"]` in `.next/server/middleware-manifest.json`) and OpenNext bundles it; as `proxy.ts` it emits `functions["/_middleware"]` with `runtime: "nodejs"` and the Cloudflare build exits 1. This is a good example of why `cf:preview` is not optional.
- **`lib/supabase/client.ts` / `lib/supabase/server.ts`** — the browser client (`createBrowserClient`) and its server counterpart (`createServerClient`), both using `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from `.env.local`. **Both use the publishable key**: server-side reads are still meant to pass through RLS (ADR 0004). The secret key appears only where bypassing RLS is the point — the reservation hold (#15) and the Stripe webhook (#18). Create the server client per request; never hoist it to module scope, or one visitor's session leaks into another's request.

  **This project uses Supabase's current API keys, not the legacy `anon`/`service_role` JWTs** — it was created after the cutover and legacy keys were never available on it. The browser key is `sb_publishable_...` (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`); server-side code uses `sb_secret_...` (`SUPABASE_SECRET_KEY`), which bypasses RLS and must never reach a client component or a `NEXT_PUBLIC_` variable. Two gotchas: a secret key sent from a browser is rejected with a 401 (a backstop, not a substitute for care), and neither key type may be sent in an `Authorization: Bearer` header unless it exactly equals the `apikey` header.
- `/profile` and checkout are referenced in the nav but not yet implemented as routes. `/cart` exists as of #12/#13; its Checkout button is deliberately inert until #15.
- **Catalog pages are `export const dynamic = "force-dynamic"`** — deliberately uncached, because stock changes and a stale "Few Left" badge misleads a paying customer. When traffic and catalog size justify it, the upgrade path is `export const revalidate = 60` on the catalog routes plus OpenNext's KV incremental cache in `open-next.config.ts`. That is an October decision, not a launch blocker.

### Deployment

Cloudflare Pages/Workers via the OpenNext adapter (ADR 0005), **not** Vercel — chosen because Vercel's free tier prohibits commercial use. `open-next.config.ts` and `wrangler.jsonc` are committed; `wrangler.jsonc` holds **no secrets**, and production values are set in the Cloudflare dashboard.

This path is verified, not assumed: `@opennextjs/cloudflare` bundles this app and serves every route on the local workerd runtime. `wrangler dev` also picks up `.env.local` automatically, so `npm run cf:preview` gives good local parity. Some `next.config.ts` options and Node APIs behave differently under workerd than under `next dev` — when adding either, check it through `cf:preview`, not just `npm run dev`.

**Deploys happen on Cloudflare Workers Builds, from a push — not from a laptop** (ADR 0005, amended 2026-08-30), because OpenNext warns on every Windows build that it "could encounter unpredictable failures during runtime" and this is a Windows machine. Project settings are **build command `npm run cf:build`, deploy command `npx wrangler deploy`**. Do not put `npm run build` in front of the build command: `opennextjs-cloudflare build` runs `next build` itself, so it would build Next twice.

**Two build configurations answer to this repo, and only the `main` one deploys.** A push to `main` builds with the configured `npm run cf:build` and `npx wrangler deploy`, and goes live. A push to any other branch has, since at least 2026-09-09, built with `npm run build` and `npx wrangler versions upload` instead — and always fails at the deploy step with `The entry-point file at ".open-next/worker.js" was not found`, because `next build` writes `.next/` and stops while `wrangler.jsonc` names `.open-next/worker.js` as `main`.

**So a red Workers Builds check on a PR branch is not evidence that the branch is broken.** Proven 2026-09-10 by an identical-tree pair: commit `ae423ef` failed on its own branch, and merge commit `f1e649e` — `git diff` between them is empty, not one byte of difference — built green on `main` eleven minutes later. Whatever differs between the two paths, it is not the code.

**Read the build's own receipt, not the Settings page.** Every build page carries a Build settings block recording what *that* run actually used — build command, deploy command, build token, build variables. The two runs above differ in all four, including the build token, which is what says they came from different configurations rather than from a setting someone changed. Settings → Build shows only what the next production build will use, so it cannot explain a build that already ran.

The Deploy command (`npx wrangler deploy`) runs for the production branch and the Version command (`npx wrangler versions upload`) for every other branch; a version upload never goes onto live traffic, which is why no branch build can affect the site either way.

After a deploy that should have changed something, confirm the change on the live URL. The dashboard showing no failure is not that confirmation.

**`.env.local` reaches neither the remote build nor the deployed worker.** It is gitignored, so Cloudflare's builder never sees it. Cloudflare keeps **two separate stores** and, in their words, *"build variables will not be accessible at runtime"* — putting a value in the wrong one fails silently in both directions:

| Value | Store | Why |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Build** variables (Settings → Build) | Next inlines `NEXT_PUBLIC_*` at build time; missing here gives a **successful build** and a storefront that cannot reach Supabase |
| `SUPABASE_SECRET_KEY`, Stripe keys (#26) | **Worker** secrets (Settings → Variables & Secrets) | No build reads them; needed at request time by #15 and #18. In build variables they are simply absent when the payment code runs |

Never give a server-only key a `NEXT_PUBLIC_` prefix — that prefix is what ships a value to browsers.

**If a build fails at the deploy step rather than the build step, check the API token first.** Cloudflare shows "Configured API token unavailable" when the token authorising `npx wrangler deploy` has been deleted, rotated, or rolled — which happens with no change on our side. Fix: create a new token from the build settings dropdown.

Because a merge to `main` deploys, `npm run cf:preview` before merging is the last chance to catch a workerd-only problem in private.

### Styling conventions

- Tailwind v4 config-less setup: theme tokens (custom colors `ssuni-brown`, `ssuni-light1`, `ssuni-light2`, `ssuni-slate`, `ssuni-sage`; font variables `--font-cinzel`, `--font-belleza`) are declared via `@theme` in `app/globals.css`, not a `tailwind.config.js`.
- Two Google fonts loaded in `app/layout.tsx`: **Cinzel** (`font-cinzel`, used for headings/brand) and **Belleza** (`font-belleza`, used for body/UI text). Follow this split when adding new UI text.
- The `@/*` path alias maps to the project root (see `tsconfig.json`), but existing components mix `@/` and relative imports (e.g. `app/login/page.tsx` uses relative imports "to avoid path alias issues") — check surrounding code in a file before choosing which style to use there.

## Agent skills

### Issue tracker

Issues live as GitHub Issues in `KaungCS/ssuni-website`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) used as-is. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Skills the assistant cannot see

Several installed skills set `disable-model-invocation: true`, which hides them from the assistant's skill listing entirely. They work fine when the user types them, but **the assistant will never see or suggest them**, so don't conclude a skill is missing just because it isn't listed — check `~/.claude/skills/` and the plugin marketplace directory.

Currently hidden: `/thermo-nuclear-code-quality-review`, `/improve-codebase-architecture`, `/to-tickets`, `/to-spec`, `/triage`, `/wayfinder`, `/implement`, `/grill-with-docs`, `/ask-matt`.

**Timing rule for the two architecture/quality passes, agreed 2026-08-24:** run `/thermo-nuclear-code-quality-review` on the checkout-and-webhook branch in week 4, before merging — that is the most logic-dense code and the last point where restructuring is cheap. Hold `/improve-codebase-architecture` until **October**, when the Admin Dashboard adds a second consumer of the same Product and Order data and shallow modules start to actually hurt.

**No architecture passes after week 4.** Weeks 5 and 6 are a freeze. A structural refactor that late is the most likely way to break a working store before a hard deadline, and "the code looks better" is not on the launch gate list — RLS, legal pages, webhook idempotency, and the live smoke test are.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
