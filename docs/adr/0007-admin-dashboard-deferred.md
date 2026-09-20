# Admin Dashboard deferred past launch; Supabase Studio in the interim

ADR 0002 justified moving Products and Variants into Supabase as "a hard prerequisite for the Admin Dashboard, one of the most important planned features" — which framed the dashboard as launch scope. With five and a half weeks to the hard end-of-September deadline and one part-time developer, the full dashboard (Product CRUD, Hero Story and Slot assignment, Orders, Hidden/Archive) does not fit alongside the Supabase migration, Cart, Stripe, Orders, RLS, and legal pages. We chose to defer it: at launch the client manages Products and Hero Stories directly in Supabase Studio, and only a minimal Orders-only admin view ships — list Orders, mark `Shipped`, enter a Tracking Link. That view is the true launch requirement, because a sale that cannot be fulfilled is worse than a catalog that is awkward to edit. Building the full dashboard anyway and cutting Stripe or the legal pages instead was rejected: those are what make the site a store rather than a brochure.

This does not invalidate ADR 0002 — Orders, Stripe, and RLS all need the database regardless, and Vercel's read-only filesystem was never the only reason to move off JSON — but the stated urgency behind that ADR now rests on a different argument than the one it records.

## Consequences

The client works in Supabase Studio at launch, which means real training on a developer-facing tool and a genuine risk of a mis-edited row against no validation layer. Supabase Studio access is also full table access, so the Hidden flag and the Archive are conventions the client has to honour by hand rather than affordances the UI enforces. This holds only as long as the deferral does — the Admin Dashboard should be first scope in October, not an indefinite postponement.

## Amendment, 2026-09-19: the deferral is lifted; the full Admin Dashboard ships in September

The deferral above was costed against "five and a half weeks" of work that had not yet been done. Weeks 1–4 finished early and [#22](https://github.com/KaungCS/ssuni-website/issues/22) (a week-5 item) shipped with them, so the constraint changed: the binding risk to 2026-09-30 is now the client-owned track — real photography, the business entity, the domain — none of which is code. We chose to spend the recovered capacity on the Admin Dashboard rather than bank it.

**What made it affordable was not extra time, it was discovering the schema was already finished.** `products`, `variants` and `hero_stories` each already carry a `*_admin_write` policy plus `grant insert, update, delete … to authenticated`, and `orders` carries `orders_admin_all` plus a column-scoped `grant update (status, tracking_link)`. Every one of those was written for this dashboard and then never consumed. So the remaining cost was forms over policies that already existed — not a schema project, and notably **not a new `lib/supabase/admin.ts` caller**, because RLS already expresses "only the admin may write this" exactly. `CLAUDE.md` predicted `/admin/orders` would become the third caller bypassing RLS. It does not, and should not.

Scope is now Orders, Products, Variants, Hero Stories, and image upload to the Storage bucket of [ADR 0009](./0009-product-images-in-supabase-storage.md). Hero Story management was included after being argued out: it is the surface the client touches least, which is exactly why doing it by hand in Studio is the one most likely to be got wrong on the rare occasion it happens.

## Consequences of the amendment

The Consequences above are retired: the client no longer needs Supabase Studio training to run the shop, and the Hidden flag and Archive become affordances the UI enforces rather than conventions honoured by hand. Studio remains the break-glass path, not the daily one.

The cost lands on the audit. The dashboard adds the first browser writes this codebase has ever made to `products`, `variants` and `hero_stories` — policies that were, until now, only ever proved by *denying* an anon client. [#24](https://github.com/KaungCS/ssuni-website/issues/24) must therefore exercise the admin path positively as well as negatively, and must cover the Storage bucket, which did not exist when ADR 0004's checklist was written.

This does **not** reopen the October scope wholesale: analytics, bulk editing, and anything resembling a reporting surface remain out. The test is whether the client can run the shop without opening Studio, not whether the dashboard is complete.
