# SSUNI

Storefront for SSUNI, a clothing brand. Next.js 16 (App Router) + React 19 +
Tailwind v4, Supabase for the catalog and auth, Stripe hosted Checkout for
payment, deployed to Cloudflare Workers via the OpenNext adapter.

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest
npm run lint     # expect 6 warnings, 0 errors
```

Local config lives in `.env.local` (never `.env`), which is gitignored. The
Supabase URL and publishable key are required for anything to render; Stripe
keys are set by `scripts/setup-stripe.sh`.

## Before you change anything

**Read [CLAUDE.md](CLAUDE.md) first.** It is the operating manual, not a
formality — it documents the traps that have already cost real debugging time
here: the npm 10 lockfile recipe, why `middleware.ts` must not be renamed to
`proxy.ts`, why builds must not run while `npm run dev` is running, and which
Cloudflare variable store each secret belongs in.

- [CONTEXT.md](CONTEXT.md) — the domain vocabulary (Product, Variant,
  Reservation, Available Stock, Collection). Terms are capitalised in code
  comments when they mean the domain concept.
- [docs/adr/](docs/adr/) — the decisions and why the alternatives were rejected.
- [docs/roadmap-september.md](docs/roadmap-september.md) — the plan of record,
  including the cut order when the schedule slips. Prefer picking up an existing
  GitHub issue over inventing new scope.

## Deployment

Pushes to `main` build and deploy through Cloudflare Workers Builds. Branch
builds use a different configuration and always fail at the deploy step — a red
check on a PR branch is expected and is not evidence the branch is broken. See
the Deployment section of CLAUDE.md before drawing conclusions from a build log.

Run `npm run cf:preview` before merging: it serves the app on the real workerd
runtime, which is the only place some failures appear.
