# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Next.js, localhost:3000)
npm run build    # production build
npm run start    # run production build
npm run lint     # eslint (flat config, eslint-config-next)
```

There is no test suite configured in this project yet — setting one up (e.g. Vitest + React Testing Library for components/logic; Playwright can follow later for the checkout flow) is an early task, needed before the workflow below can actually be followed.

## Development workflow

- **Write test cases before implementation.** For any new feature or functionality (not bug fixes in isolation), write the failing test(s) first, confirm they fail for the right reason, then implement until they pass. Use the `tdd` skill (`mattpocock-skills:tdd`) for this.

## Architecture

Next.js 16 App Router site (React 19, TypeScript, Tailwind CSS v4) for SSUNI, a clothing storefront.

- **`app/`** — routes. `app/page.tsx` (home), `app/catalog/page.tsx` (grid of all products), `app/catalog/[slug]/page.tsx` (client-rendered product detail with color/size variant selection), `app/login/page.tsx` (Supabase email-OTP auth flow).
- **`components/`** — `NavBar.tsx` + `ShopDropdown.tsx` form the sticky header and hover-triggered mega menu (menu links point to `/catalog` with query params like `?department=`, `?category=`, `?collection=` — none of these query params are currently read/filtered by `catalog/page.tsx`, so wiring that up is unfinished). `ProductGrid.tsx` renders the catalog grid. `HeroStory.tsx` is the full-bleed home page hero.
- **`data/products.json`** — the entire product catalog is static JSON, imported directly (`import products from ".../data/products.json"`) rather than fetched. Each product has an array of `variants` (`{ color, size, stock }`); the detail page derives available colors/sizes and stock state from this array — there is no separate variants API or DB table yet.
- **`lib/supabase.ts`** — creates a Supabase **browser** client (`createBrowserClient` from `@supabase/ssr`) using `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local`. Supabase is currently only used for auth (OTP sign-in in `app/login/page.tsx`); there is no server client, middleware, or session-refresh setup yet, and no database calls beyond auth.
- Cart, profile, and checkout are referenced in the nav (`/cart`, `/profile`) but not yet implemented as routes.

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
