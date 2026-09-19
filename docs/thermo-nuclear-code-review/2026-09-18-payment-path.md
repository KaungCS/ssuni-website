# Thermo-nuclear code quality review — the payment path

**Date:** 2026-09-18 · **Reviewer:** Claude Opus 5 via `/thermo-nuclear-code-quality-review`
**Launch:** 2026-09-30 (hard) · **Status at review time:** week 4, one day before the declared weeks 5–6 structural freeze

---

## Why this scope

The skill's default target is "the current branch's changes". That was deliberately overridden.

`feat/hero-stories-and-launch-ux` is one commit of Hero Stories and launch UX and touches none of
the payment path. Reviewing it would have audited sitemap tags and a hero component while the money
path went unexamined — the opposite of why CLAUDE.md schedules this pass for week 4, "on the
checkout-and-webhook branch, before merging — that is the most logic-dense code and the last point
where restructuring is cheap."

**Primary target** — the payment path as it exists on `main`, landed across `a546012` (#15) through
`431ba86` (#20):

- [`app/api/checkout/route.ts`](../../app/api/checkout/route.ts)
- [`app/api/stripe/webhook/route.ts`](../../app/api/stripe/webhook/route.ts)
- [`lib/stripe.ts`](../../lib/stripe.ts)
- [`lib/cart.ts`](../../lib/cart.ts)
- [`lib/orders.ts`](../../lib/orders.ts)
- [`app/api/cart/resolve/route.ts`](../../app/api/cart/resolve/route.ts)
- [`components/CartProvider.tsx`](../../components/CartProvider.tsx)
- [`supabase/migrations/20260918130000_complete_checkout.sql`](../../supabase/migrations/20260918130000_complete_checkout.sql)

**Secondary target, lower priority** — commit `c5016c5` (`lib/hero.ts`, `lib/site.ts`,
`app/layout.tsx`, `components/HeroStory.tsx`), because it is about to merge and findings there are
actionable.

Read before forming any opinion: `CLAUDE.md`, `CONTEXT.md`, ADRs 0001 / 0004 / 0008 / 0010, and
`docs/roadmap-september.md`.

### Ruled out of bounds before the review began

These are documented decisions where the obvious refactor is a bug that was already hit and
reverted. They were not candidates and are not findings: `lib/catalog-url.ts`'s split from
`lib/catalog.ts` (#50), `CartProvider`'s `useSyncExternalStore`, `middleware.ts` not becoming
`proxy.ts`, `constructEventAsync` + `createSubtleCryptoProvider()`, `lib/taxonomy.ts` duplicating
the SQL CHECK constraints (#49, parked), `complete_checkout` living in Postgres rather than the
route, `/api/cart/resolve` being POST, and catalog/Order pages being `force-dynamic` (#41).

---

## Verdict: the payment path is in good shape

I went looking for a dangerous bug on the money path and did not find one. Four claims were
verified against the code rather than against the comments that assert them.

**Idempotency really does rest on nothing but the unique index.** Two concurrent deliveries
serialize on `orders_stripe_session_id_key`; the second blocks until the first commits, then takes
the `on conflict do nothing` branch and returns `NULL`. `complete_checkout` deliberately *not*
filtering reservations on `status = 'held'` is correct — a hold that lapsed between payment and a
retried delivery still describes what was bought, and skipping it would write an Order with missing
lines and untaken stock. `supabase/tests/admin-path.sql` assertions 22–29 prove the whole property
against a real database, including that a replay creates no second Order, no second Order Item, and
no second stock decrement.

**Pricing is genuinely single-sourced.** The webhook reads `products.price` nowhere.
`order_items.unit_price` ← `reservations.unit_price` ← the same `variants` map that built the Stripe
line, inside one function call. `admin-path.sql` assertion 23 pins it at 19.99 explicitly, which is
the check that the price came from the Reservation rather than a live re-read. The claim holds end
to end.

**The `getMyOrders` reasoning still holds.** `orders_select_own` and `orders_admin_all` are both
`for select to authenticated` and Postgres OR's policies of the same command — so for the admin
account, "whatever RLS returns" is every customer's Orders. Drop the explicit `.eq("user_id", …)`
and `/profile` silently becomes an admin dashboard. It is load-bearing, not redundant.
`getOrderBySession`'s deliberate absence of one is fine: `anon` has no policy at all and no
`select` grant, so a pasted `session_id` yields nothing to a signed-out visitor.

**Nothing is left half-applied between the hold and the Session.** The compensation is self-healing
in both directions. A failed hold expires the Session; `sessions.expire()` itself failing is
covered, because the Session lapses at `expires_at` regardless and fires `checkout.session.expired`,
which the release branch handles. A `reserve_cart` that commits in Postgres but loses its HTTP
response is covered by the same path. That is better than it needed to be.

### No restructuring is proposed for the webhook route

Its control flow is linear, one level of nesting, one early return per branch. A `switch` on
`event.type` or a handler map would add concepts without removing any. The completed/expired
branching is two shapes of work that genuinely differ — one RPC, one single-statement UPDATE — and
the status-code protocol is applied consistently: 2xx unless a *later attempt could succeed where
this one failed*.

This is not restraint on account of the freeze. There is no code-judo move here worth making.

**What it needed was tests.**

---

## Test and lint state

| | Before | After |
| --- | --- | --- |
| `npx vitest run` | 61 passed, 4 files | **74 passed, 5 files** |
| `npx tsc --noEmit` | clean | clean |
| `npm run lint` | 6 warnings, 0 errors | 6 warnings, 0 errors |

The 6 lint warnings are all `<img>`-vs-`next/image`, tracked in issue #11, exactly as CLAUDE.md
documents. `npm run build` was deliberately **not** run — CLAUDE.md forbids it while `npm run dev`
may be live, because it rewrites `.next` underneath the dev server.

---

# FIX NOW

Small, well-understood, trivially verifiable, and on the money path. All four are **applied to the
working tree and uncommitted** — see [Working-tree state](#working-tree-state) at the end.

## 1. The webhook's orchestration had no tests at all

**Highest risk on this list.**

`lib/stripe.test.ts` covers `parseCompletedSession` — the pure parsing seam, 5 tests.
`supabase/tests/admin-path.sql` covers `complete_checkout`'s idempotency against the real unique
index. Between them sat the route itself: which branch runs, what it calls, and **what status code
it returns**. Nothing covered that, and CLAUDE.md issue #32 names the webhook as TDD-required.

The dangerous direction is not a 500 where a 200 belongs — that buys three days of retries and an
eventual "endpoint is failing" email, which is noisy but visible. It is a **200 where a 500
belongs**: Stripe stops redelivering, the Order is gone permanently, and the money has already been
taken. Nothing in this repo would have caught that.

### A trap found while writing them

[`vitest.config.ts`](../../vitest.config.ts) collected only `lib/**/*.test.ts` and
`components/**/*.test.tsx`. **A test file under `app/` is silently never collected** — it passes by
not running. The include list now carries `app/**/*.test.ts`, with a comment saying why.

### The 11 tests

New file [`app/api/stripe/webhook/route.test.ts`](../../app/api/stripe/webhook/route.test.ts).

| Case | Asserted |
| --- | --- |
| missing `STRIPE_WEBHOOK_SECRET` | 500, fails shut, `constructEventAsync` never called |
| missing `stripe-signature` header | 400 |
| signature does not verify | **400, never 500** — an unverifiable payload never verifies |
| raw body | passed to `constructEventAsync` byte-for-byte, not reparsed |
| completed + paid | `complete_checkout(session, user, 65.97)` — decimal dollars, not cents |
| completed + unpaid | 200, **RPC not called** |
| completed + DB error | **500**, so Stripe retries |
| completed + RPC returns `NULL` | 200, `"Already recorded."` |
| expired | `status: released`, filtered on `stripe_session_id` **and** `status = 'held'` |
| expired + DB error | 500 |
| unhandled event type | 200, touches neither Supabase call |

Everything external is mocked, because the route holds no logic of its own — the question is only
which of two calls it makes and what it answers with. `parseCompletedSession` is left real via
`importOriginal`, since it is the seam the route trusts.

### Mutation-checked, not trusted

A green test net proves nothing until it has been seen to fail. Two mutations were applied to the
route and the suite re-run:

- deleting `.eq("status", "held")` from the expired branch
- changing the `complete_checkout` error response from 500 to 200

Both were caught — exactly 2 tests failed. The route was then restored and `git diff` on it
confirmed empty.

## 2. `CHECKOUT_TTL_SECONDS` sat exactly on Stripe's floor

```diff
--- a/lib/stripe.ts
+++ b/lib/stripe.ts
-export const CHECKOUT_TTL_SECONDS = 30 * 60;
+export const CHECKOUT_TTL_SECONDS = 31 * 60;
```

Stripe's documented minimum is 30 minutes **after Session creation**, measured from when the request
reaches Stripe — not from the `Date.now()` that built it. Sitting exactly on the floor spends the
entire margin on the network hop. On workerd it is worse: `Date.now()` reports the time of the last
I/O rather than the current instant, so the value can already be stale before it is sent.

**Honest caveat: I cannot demonstrate this fires today.** #15 evidently works, so Stripe tolerates
the current value. This removes a boundary that costs a shopper nothing to move away from — a
31-minute Session is indistinguishable from a 30-minute one.

## 3. Order line totals were computed in JSX, twice, with raw float multiply

[`lib/cart.ts`](../../lib/cart.ts) goes to real trouble with `toCents` so `19.99 * 3` never becomes
`59.97000000000001` — the comment explains that tail reaches both the shopper's screen and the
amount charged. Then both `app/checkout/success/page.tsx:101` and
`app/profile/orders/[id]/page.tsx:138` did `money(line.unitPrice * line.quantity)` inline.

Separately, `money()` existed verbatim in two files — `app/cart/page.tsx:36` and
`lib/orders.ts:178` — because `/cart` is a client component and cannot import `lib/orders.ts`, which
reaches `next/headers`.

**No rendered number changes.** `toFixed(2)` rescues the displayed value: `unitPrice` has two
decimals and `quantity` is an integer, so the exact product always has two decimals and never lands
on a half-cent rounding boundary. This is about the rule having one implementation, in the layer
that tells a customer what they paid — the same reason ADR 0001 insists the subtotal is computed
once.

Both helpers now live in `lib/cart.ts` — the only money module both halves of the app can reach,
since it imports nothing — and `lib/orders.ts` re-exports them so Order pages keep a single import.
Two new tests in `lib/cart.test.ts`, one of which asserts `lineTotal` and `reconcile`'s subtotal
agree for a single-line Cart.

## 4. The home page had no empty state, and no `<h1>`, if every Hero Story is Hidden

#22 moved a guaranteed hero out of the code and into a table. The migration seeds row 0, but hiding
it is one click in Supabase Studio — plausible during week 6 while the client swaps placeholder
content for real photography.

The result was the landing page rendering as one stray "The SSUNI Philosophy" paragraph, **with no
`<h1>` anywhere on the site's root page**, since the first Story carries it. Week 6 already lists
"empty states" as launch work; this is the one that matters most.

A minimal branded fallback now carries the `h1`, with a comment explaining what it is guarding
against so it does not read as dead code later.

---

# ISSUE FOR OCT

Real improvements that require restructuring, new tests, or touch something the freeze protects.
Written as pasteable GitHub issue bodies.

## A. `/api/checkout` has no route-level tests

**Problem.** The webhook now has a characterization net; the other half of the money path does not.
Untested in `app/api/checkout/route.ts`: the 401 login gate, the 409 preflight, the 502 Stripe path,
the 502/409 split after `reserve_cart`, and — most importantly — **the compensation that expires the
Stripe Session when the hold fails**. `supabase/tests/rls.mjs` section 9 proves the RPC. Nothing
proves the route calls it correctly or cleans up after itself.

**Why it matters.** The compensating `stripe.checkout.sessions.expire()` is the only thing standing
between a failed hold and a live Session with no stock behind it. It is currently a
`.catch(() => {})` that nothing exercises.

**Proposed approach.** Same harness as `app/api/stripe/webhook/route.test.ts`: `vi.mock` on
`@supabase/supabase-js`, `@/lib/stripe`, `@/lib/supabase/server` and `@/lib/catalog`. Assert the call
*order* — the Session is created before the hold, deliberately, so the Reservation carries Stripe's
real session id — and that `sessions.expire` fires on both the error branch and the shortfall branch.

Roughly an hour now that the pattern exists. **Cheap enough to pull forward before launch if week 5
has room** — tests are not refactors, and the freeze governs refactors.

**Affected files.** `app/api/checkout/route.ts`, new `app/api/checkout/route.test.ts`.

## B. A Reservation lapses at the same instant as its Stripe Session

**Problem.** `p_expires_at` is set to `session.expires_at` exactly. A shopper who pays a few seconds
before the 30-minute mark is accepted by Stripe, but the hold lapses at the mark — and
`variants_available` counts only Reservations with `expires_at > now()`. Between that instant and
the webhook landing, the stock is unheld and another shopper can buy the same unit.
`complete_checkout` then floors at `greatest(stock - qty, 0)` and the shop is oversold.

**Why it matters.** Narrow, but it is precisely the failure ADR 0010 exists to close, reappearing at
the edge of the window rather than in the middle of it. ADR 0010 does already document floor-at-zero
as the accepted outcome — "the sale stands and the count floors at zero" — so this is a tightening,
not a bug report.

**Proposed approach.** Give the Reservation a grace period past the Session:

```ts
p_expires_at: new Date((session.expires_at + RESERVATION_GRACE_SECONDS) * 1000).toISOString()
```

about five minutes. It costs nothing: a cancelled checkout's hold lives to its `expires_at` either
way, and `checkout.session.expired` still releases it early. Needs a paragraph in ADR 0010 recording
why the two timestamps deliberately differ, or the next reader will "fix" it back.

**Affected files.** `app/api/checkout/route.ts`, `lib/stripe.ts`,
`docs/adr/0010-reserve-stock-at-checkout.md`.

## C. A permanently failing webhook is completely silent

**Problem.** If `complete_checkout` fails for a non-transient reason — an FK violation, a constraint,
schema drift after a migration — the route correctly returns 500, Stripe retries for three days, and
then gives up. The result is **money taken, no Order, no stock decrement, no Order Items**, and a
single `console.error` in a Worker log nobody is tailing. CLAUDE.md's launch gate lists "webhook
idempotency" but not "an alarm when the webhook is failing."

**Why it matters.** Every other failure mode in this system is self-healing — a lapsed hold frees
stock with no webhook at all, a lost response is recovered by a retry. This one is not, and it is
invisible by construction.

**Proposed approach.** Most of the value is free and belongs in **#26, not October**: confirm
Stripe's failing-endpoint email notification is enabled on the live account before the live-mode
smoke test. Then, for October, a reconciliation read — Stripe payments in the last 24 hours with no
matching `orders.stripe_session_id` — surfaced as a page in the Orders admin (#21).

**Affected files.** `scripts/setup-stripe.sh` (the #26 checklist), later `app/admin/orders`.

## D. The secret-key Supabase client is built inline in two routes

**Problem.** This appears verbatim in `app/api/checkout/route.ts:129` and
`app/api/stripe/webhook/route.ts:84`:

```ts
createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)
```

each with a comment explaining it is one of exactly two places the secret key is used. That
invariant is asserted in prose in three files and enforced nowhere.

**Why it matters.** CLAUDE.md predicts the Admin Dashboard as the third caller in October. And the
`!` assertions turn the misconfiguration CLAUDE.md devotes a whole table to — Worker secret vs build
variable — into `TypeError: supabaseKey is required`, with no indication of which key or which
store.

**Proposed approach.** A `lib/supabase/admin.ts` beside `client.ts` and `server.ts`, with a named
error on a missing key and a docblock listing its callers — so "grep this module's importers"
answers "who bypasses RLS?". Explicitly an October item: it touches the money path, and it lines up
with the `/improve-codebase-architecture` pass CLAUDE.md already schedules for when the Admin
Dashboard adds a second consumer of the same data.

**Affected files.** New `lib/supabase/admin.ts`, `app/api/checkout/route.ts`,
`app/api/stripe/webhook/route.ts`, CLAUDE.md.

---

# DROP

Considered and rejected, so it is on record that they were looked at.

- **Parallelise `auth.getUser()` with `getVariantsByIds()`** — saves one round trip for signed-in
  shoppers, spends a catalog query on every signed-out probe; the gate ordering is deliberate and
  documented, and the auth check is also the cheapest abuse gate on the route.
- **`switch` on `event.type` in the webhook** — same branch count, one more concept.
- **`getVariantsByIds`'s `price: Number(row.products?.price ?? 0)`** — wrong-direction fallback (a
  $0 line reads as `ok` through `reconcile`, where `availableStock ?? 0` correctly reads as
  `unavailable`), but `products.price` is `not null`, so the branch is unreachable. Not worth
  touching the money path to fix dead code.
- **Guard `SUPABASE_SECRET_KEY` the way `STRIPE_WEBHOOK_SECRET` is guarded** — turns one 500 into a
  differently-worded 500. Folded into issue D instead.
- **`toStripeLineItems` silently skipping a missing variant** before the route's
  `variants[id].price` throws — the ordering is theoretically backwards, but reachable only if the
  preflight 409 is removed first.
- **`components/HeroStory.tsx` taking `index` where it uses only `isFirst`** — genuine nit, not
  worth a diff on a branch about to merge.
- **`cta.href` from the database straight into `next/link`** (a `javascript:` URL) — `hero_stories`
  writes are admin-only, and an admin already has more power than that.
- **A signed-in admin seeing Hidden Hero Stories on the storefront** — identical to Hidden Products,
  documented in `lib/hero.ts`, a preview rather than a leak.
- **`getOrderBySession` returning any Order to the admin account** — that is what admin means, and
  they have `/admin/orders` anyway.
- **Array index as the React key on `order_items`** — the list never reorders or changes length; the
  existing comment already says so.
- **`reconcile`'s nested ternary for `status`** — three states, five lines, reads fine.

---

## Working-tree state

At the time of writing, **uncommitted and unpushed**. Nothing was committed on your behalf.

```
 M app/cart/page.tsx
 M app/checkout/success/page.tsx
 M app/page.tsx
 M app/profile/orders/[id]/page.tsx
 M lib/cart.test.ts
 M lib/cart.ts
 M lib/orders.ts
 M lib/stripe.ts
 M vitest.config.ts
?? app/api/stripe/webhook/route.test.ts
```

`git diff --stat` — 9 files, 85 insertions, 17 deletions, plus the new test file.

Mapping back to the findings:

| Finding | Files |
| --- | --- |
| FIX NOW 1 — webhook tests | `app/api/stripe/webhook/route.test.ts` (new), `vitest.config.ts` |
| FIX NOW 2 — TTL margin | `lib/stripe.ts` |
| FIX NOW 3 — line totals, `money()` | `lib/cart.ts`, `lib/cart.test.ts`, `lib/orders.ts`, `app/cart/page.tsx`, `app/checkout/success/page.tsx`, `app/profile/orders/[id]/page.tsx` |
| FIX NOW 4 — hero empty state | `app/page.tsx` |

`app/api/stripe/webhook/route.ts` itself is **unmodified** — it was mutated during verification and
restored.

---

# Resolution — 2026-09-19

Added the day after the review. The findings above are left exactly as written;
this section records what was done about them, and by whom, so the two can be
compared later.

Kaung's call was **all four October items, including D**, against the
recommendation to defer D as the one genuine refactor inside the weeks 5–6
freeze. That decision is recorded here rather than argued again.

| Finding | Outcome |
| --- | --- |
| FIX NOW 1–4 | Committed as reviewed, unchanged. `f88f599`, `7ef4f0f`, `43a1401` |
| A — `/api/checkout` untested | **Done.** `app/api/checkout/route.test.ts`, 15 tests, mutation-checked |
| B — Reservation lapses with its Session | **Done.** `RESERVATION_GRACE_SECONDS`, ADR 0010 amended |
| C — silent failing webhook | **Half done.** The free half is in `scripts/setup-stripe.sh`; the reconciliation read is issue #65 |
| D — inline secret-key client | **Done.** `lib/supabase/admin.ts` |

Three claims in the findings were re-verified against the code before acting on
them, rather than taken from the prose:

- **B's "it costs nothing" holds.** `private.variant_available_stock`
  (`20260825130000_shrink_definer_surface.sql:62-77`) filters on `status =
  'held'` **and** `expires_at > now()`. So a grace period past the Session
  cannot strand stock: `checkout.session.expired` sets `released` and frees it
  immediately, grace or no grace. Had the function filtered on `expires_at`
  alone, the proposed fix would have held an abandoned Cart's stock for five
  extra minutes and B should have been rejected.
- **Nothing else assumed the two timestamps were equal.** `supabase/tests/rls.mjs`
  passes its own `inThirtyMinutes()` to `reserve_cart`, so B is route-local.
- **A's compensation really was unexercised.** Deleting
  `sessions.expire(session.id)` from the route before the new tests existed
  changed no test result at all.

**Mutation-checked, both new suites.** A green net proves nothing until seen to
fail. `app/api/checkout/route.test.ts`: deleting the compensating `expire()`
call failed exactly 2 tests, defeating the login gate failed exactly 1. B was
written test-first and failed for the right reason — *expected 1800000000 to be
greater than 1800000000* — before the fix. The route was restored after each
mutation and `git diff` confirmed empty.

**State after.** `npx vitest run` 92 passed / 7 files (was 74 / 5).
`npx tsc --noEmit` clean. `npm run lint` 6 warnings, 0 errors — the `<img>` set
from #11, unchanged.

**Not done, deliberately.** The reconciliation read from C (Stripe payments in
the last 24 hours with no matching `orders.stripe_session_id`) is filed as
issue #65 against the Orders admin in #21, where it has a page to live on.
