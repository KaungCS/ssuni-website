# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Next.js, localhost:3000)
npm run build    # production build
npm run start    # run production build
npm run lint     # eslint (flat config, eslint-config-next)

npm run cf:build    # bundle a Cloudflare worker via OpenNext
npm run cf:preview  # build + serve the worker on the real workerd runtime
npm run cf:deploy   # build + deploy to Cloudflare
npm run cf:typegen  # regenerate cloudflare-env.d.ts from wrangler.jsonc

npm run db:push     # apply supabase/migrations to the linked project
npm run db:verify   # RLS suite + admin-path suite + Supabase security advisor
```

`npm run db:verify` is the schema's test suite and should be green before any PR that touches `supabase/`. It writes nothing permanent (the Reservation it creates is deleted; the admin-path SQL runs inside a transaction that rolls back), so it is safe against production. The advisor's only expected findings are `rls_auto_enable` ×2 — a Supabase platform event trigger, not RPC-callable — and leaked-password protection, which is moot while auth is email-OTP only. **Anything else the advisor reports is a real finding.** Extend `supabase/tests/rls.mjs` as tables are added, so the #24 RLS audit is a re-run rather than a manual walk.

`npm run lint` should report **5 warnings, 0 errors** (all `<img>`-vs-`next/image`, tracked in issue #11). If it reports thousands, a build-output directory has escaped the ignore list in `eslint.config.mjs` — the patterns are deliberately unanchored (`**/.next/**`, `**/.open-next/**`, …) because root-anchored ones missed a nested build dir once and buried the real findings 800:1. **Add any new build/output directory to both `eslint.config.mjs` and `.gitignore`.**

There is no test suite configured in this project yet. **Vitest arrives with the Cart provider (#12) and the checkout route (#15)** — that is the first code where a test earns its keep, and setting one up before then would spend schedule on presentational components. See the workflow below for what it covers when it lands, and issue #32 for why the scope is narrow.

## Development workflow

- **Write test cases before implementation — for the logic that can lose money.** Decided 2026-08-25 (issue #32). TDD is **required** for: Cart totals and quantity math (#12), the reservation check-and-hold RPC (#15, ADR 0010), and Stripe webhook handling and idempotency (#18, #30). For those, write the failing test(s) first, confirm they fail for the right reason, then implement until they pass — use the `tdd` skill (`mattpocock-skills:tdd`).

  Everything else — presentational components, layout, styling, catalog rendering — is **exempt**, and writing tests for it before the September launch is out of scope, not an oversight. The rule is narrow on purpose: against ~90–115 total hours, correctness on retries and race conditions is worth the time and snapshot-testing a hero banner is not.

  Database schema is verified by querying the real database (RLS proved with an actual anon client), not by unit tests.

## Project state — read this before planning anything

SSUNI is building toward a **hard end-of-September 2026 launch**, solo, at ~15–20 hrs/week. That deadline is the binding constraint on nearly every decision in this repo, and several ADRs cite it explicitly as the reason a simpler option was chosen.

**`docs/roadmap-september.md` is the plan of record.** It sequences the work week by week, names a pre-decided cut order for when the schedule slips, and lists a client-owned track (product photography, Stripe entity verification, domain purchase) that can hold the launch date with all the code finished. Read it before proposing work, and prefer picking up an existing issue over inventing new scope.

Much of what the Architecture section below describes is **scheduled to be replaced**, not preserved — see the roadmap and the issues before "improving" any of it.

## Architecture

Next.js 16 App Router site (React 19, TypeScript, Tailwind CSS v4) for SSUNI, a clothing storefront.

- **`app/`** — routes. `app/page.tsx` (home), `app/catalog/page.tsx` (grid of all products), `app/catalog/[slug]/page.tsx` (client-rendered product detail with color/size variant selection), `app/login/page.tsx` (Supabase email-OTP auth flow).
- **`components/`** — `NavBar.tsx` + `ShopDropdown.tsx` form the sticky header and hover-triggered mega menu (menu links point to `/catalog` with query params like `?department=`, `?category=`, `?collection=` — none of these query params are currently read/filtered by `catalog/page.tsx`, so wiring that up is unfinished). `ProductGrid.tsx` renders the catalog grid. `HeroStory.tsx` is the full-bleed home page hero.
- **`data/products.json`** — the entire product catalog is static JSON, imported directly (`import products from ".../data/products.json"`) rather than fetched. Each product has an array of `variants` (`{ color, size, stock }`); the detail page derives available colors/sizes and stock state from this array — there is no separate variants API or DB table yet.
- **`lib/supabase.ts`** — creates a Supabase **browser** client (`createBrowserClient` from `@supabase/ssr`) using `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from `.env.local`. Supabase is currently only used for auth (OTP sign-in in `app/login/page.tsx`); there is no server client, middleware, or session-refresh setup yet, and no database calls beyond auth.

  **This project uses Supabase's current API keys, not the legacy `anon`/`service_role` JWTs** — it was created after the cutover and legacy keys were never available on it. The browser key is `sb_publishable_...` (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`); server-side code uses `sb_secret_...` (`SUPABASE_SECRET_KEY`), which bypasses RLS and must never reach a client component or a `NEXT_PUBLIC_` variable. Two gotchas: a secret key sent from a browser is rejected with a 401 (a backstop, not a substitute for care), and neither key type may be sent in an `Authorization: Bearer` header unless it exactly equals the `apikey` header.
- Cart, profile, and checkout are referenced in the nav (`/cart`, `/profile`) but not yet implemented as routes.

### Deployment

Cloudflare Pages/Workers via the OpenNext adapter (ADR 0005), **not** Vercel — chosen because Vercel's free tier prohibits commercial use. `open-next.config.ts` and `wrangler.jsonc` are committed; `wrangler.jsonc` holds **no secrets**, and production values are set in the Cloudflare dashboard.

This path is verified, not assumed: `@opennextjs/cloudflare` bundles this app and serves every route on the local workerd runtime. `wrangler dev` also picks up `.env.local` automatically, so `npm run cf:preview` gives good local parity. Some `next.config.ts` options and Node APIs behave differently under workerd than under `next dev` — when adding either, check it through `cf:preview`, not just `npm run dev`.

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
