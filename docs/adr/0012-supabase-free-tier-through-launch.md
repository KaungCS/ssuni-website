# Stay on the Supabase free tier through launch, and back up on a cron that also keeps it awake

On 2026-09-08 the Supabase project was found **paused**: `status: INACTIVE`, and its hostname did not resolve in public DNS at all. Free-tier projects auto-pause after 7 days without database activity, and the previous session had been 8 days earlier. Every catalog route is `force-dynamic` and reads Supabase per request, so the storefront could not have rendered a single Product. Nothing anywhere raised an alarm; the symptom was a DNS failure, which looks like anything but a billing tier.

Upgrading to Pro (\$25/month) removes the pause entirely and adds daily backups and point-in-time recovery. It was rejected on affordability, not on merit — the subscription is not payable yet. That is a constraint rather than a preference, and the decision should be revisited the moment it stops being one; **Pro before launch remains the better answer** if the money appears.

Staying free costs two things. The project pauses after 7 idle days, which post-launch means **a storefront that switches itself off during a quiet week**. And the free tier has **no automated backups and no point-in-time recovery**, on a database that from #17 and #18 onward holds real Orders and customer email addresses.

We chose to address both with a single scheduled job (issue #44): **a `pg_dump` every 3 days, uploaded as a build artifact.** The cadence is doing two jobs on purpose — a dump is itself database activity, so a job running more often than every 7 days resets the pause timer as a side effect. One job rather than two was chosen deliberately so the failure modes are shared: if it stops, backups stop *and* the project pauses, which is loud, instead of two independent jobs that can quietly half-work.

An uptime pinger against `/catalog` was the first instinct and is the right **post-launch** mechanism — the route is `force-dynamic`, so every hit is a genuine query, and it costs no code. It cannot be adopted yet: there is no domain (#7) and no DNS (#27), and it cannot be reviewed in a pull request.

## What the dump actually protects

Stripe is the authoritative record of **money**. Every payment, its `line_items`, and the customer's email survive a total loss of Supabase, and the customer's own emailed receipt corroborates it. "Did this person pay, and for what" does not depend on our database.

What exists *only* in Supabase — and is what the dump is for — is **fulfillment state and inventory**: Order Status, `tracking_link` (#17, #21), and `variants.stock`. After a loss without a dump you would know who paid you and for what, but not who you had already shipped to or what is on the shelf.

This is a real reduction in the stakes of backups, and it is part of why staying free is tolerable rather than reckless.

## Consequences

Until #44 lands, **the only thing preventing another pause is the cadence of development itself** — the mitigation is a habit, not a mechanism. A gap of more than a week reproduces 2026-09-08 exactly.

**GitHub disables scheduled workflows after 60 days of repository inactivity.** That is the identical silent-shutoff failure this decision exists to prevent, re-armed on a longer fuse and landing around late November. Whoever notices the site is down first will not think of it. Moving to the uptime pinger once #7 and #27 are done retires this.

Artifacts expire, so #44 is disaster recovery and not an archive. A dump contains **customer PII** and is readable by anyone with access to the repository, which is private and must stay that way.
