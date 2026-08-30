# Deploy to Cloudflare Pages/Workers instead of Vercel

The store needs to stay within free-tier hosting costs at launch, but Vercel's Hobby (free) plan terms prohibit commercial use — once Stripe goes live, compliant hosting there requires the $20/month Pro plan. Cloudflare Pages/Workers' free tier explicitly permits commercial use, includes SSL, DDoS protection, and a basic WAF at no cost, and its official OpenNext adapter (the path Next.js's own team now recommends) supports the App Router, SSR, ISR, and middleware this app needs. We chose Cloudflare over paying for Vercel Pro, switching before any deployment-specific code was written.

## Amendment, 2026-08-30: builds run on Cloudflare, not on the developer's machine

The original spike deployed with `npm run cf:deploy` from the developer's laptop, which is how the adapter was first proved to work. We chose instead to connect the GitHub repository to **Cloudflare Workers Builds**, so the worker that serves customers is built on Cloudflare's Linux image and deploys on a push.

The deciding factor is that `opennextjs-cloudflare build` prints, on every local run: *"OpenNext is not fully compatible with Windows. For optimal performance, it is recommended to use Windows Subsystem for Linux (WSL). While OpenNext may function on Windows, it could encounter unpredictable failures during runtime."* This is the only development machine, it runs Windows, and the artifact in question takes customers' money. Building it on the platform the tool warns about — to save configuring a remote build — is the wrong trade at any point, and especially in the weeks before launch. Local `npm run cf:deploy` remains available as a fallback, and `npm run cf:preview` remains the way to check a change on the real workerd runtime before pushing.

### The configuration this requires

`opennextjs-cloudflare build` runs `next build` itself (hence its `--skipNextBuild` flag), so a build command of `npm run build` in front of it builds Next twice. The project settings are:

- **Build command:** `npm run cf:build`
- **Deploy command:** `npx wrangler deploy`

## Consequences

**Two npm versions now build this project, and they disagree.** Cloudflare's image runs npm 10.9.2 with no override available; local npm is 11.x, which prunes optional transitive entries that npm 10's `npm ci` then rejects. `package-lock.json` must be generated with npm 10 — see `CLAUDE.md`. This is the recurring cost of the amendment above, and it is the reason to prefer it consciously rather than drift into it.

**`.env.local` does not deploy, and it no longer reaches the build either.** A local `cf:deploy` read that file; Cloudflare's builder clones the repository, where it is gitignored. Because Next inlines `NEXT_PUBLIC_*` values into the bundle at build time, a build without them **succeeds** and produces a site that cannot reach Supabase — a failure that appears at runtime, far from its cause. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must therefore be set as **build** variables in the Cloudflare project, not only as Worker secrets. Server-only values that no build inlines — `SUPABASE_SECRET_KEY`, and the Stripe keys in #26 — belong in Worker secrets, and must never be added as `NEXT_PUBLIC_`.

**A merge to `main` is now a production deploy.** That is the point, but it changes what merging means: the launch gate in #28 (one real purchase end to end) is a check on what is already live, not a check before going live.

Watch the free tier's discouragement of serving a "disproportionate share" of images/large files as the product catalog and Hero Story count grow — may eventually require moving image hosting to a dedicated service (e.g. Cloudflare Images/R2).
