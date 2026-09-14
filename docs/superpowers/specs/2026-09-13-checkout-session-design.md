# POST /api/checkout: design for issue #15

**Date:** 2026-09-13
**Issue:** [#15](https://github.com/KaungCS/ssuni-website/issues/15)
**ADRs:** [0008](../../adr/0008-stripe-hosted-checkout.md) (hosted Checkout, inline `price_data`), [0010](../../adr/0010-reserve-stock-at-checkout.md) (reserve at checkout, atomic check-and-hold), [0001](../../adr/0001-guest-local-cart.md) (Cart holds no prices)
**Status:** approved, ready for an implementation plan

## What this document is for

ADRs 0008 and 0010 settle the big calls: Stripe's hosted Checkout rather than
Payment Elements, inline `price_data` built from Supabase rather than a mirrored
catalog, and an atomic check-and-hold in Postgres rather than a read-then-write
in TypeScript. **None of that is re-argued here.**

This records the decisions those leave open — ordering, the RPC's security model
and shape, error semantics — and the two deployment risks that bite before any
of it reaches a shopper.

## 1. Ordering: the Session is created first

`reservations.stripe_session_id` is `not null`, with a unique index on
`(stripe_session_id, variant_id)` that CLAUDE.md records as the thing making
#18's idempotency detectable rather than guessed. So the ordering decides
whether that column holds a real value from the moment the row exists.

**Decision: create the Checkout Session, then reserve against its real id and
`expires_at`.** On a shortfall, expire the Session and return 409. The shopper
never receives the URL, so an un-expired orphan Session is inert — nobody can
reach it, and it lapses on its own.

This is also the only ordering that satisfies #15's "set `expires_at` to the
Stripe session's expiry" literally rather than by arranging for two computed
values to match.

**Rejected — reserve first, backfill the id.** Holds stock against a placeholder
id, then updates to the real one. Checks stock before calling Stripe, but a
failure between the two leaves holds under a fake id, and the unique index that
carries #18's idempotency would briefly be enforcing uniqueness over a value
that was never real. Self-expiring, so bounded, but three steps where one will
do.

**Rejected — reserve against our own attempt id**, passed to Stripe as
`client_reference_id` and looked up by #18. Genuinely clean, and the only option
needing a schema change: storing our id in a column named `stripe_session_id`
makes the schema lie, so it would need renaming or a second column. Not worth a
migration to save one Stripe call.

**The cost, named:** a cart that cannot be filled still costs one Stripe API
round trip. Mitigated by a **non-authoritative** availability pre-check before
step 4 — see the route flow. ADR 0010 is explicit that the RPC is the only
authority; the pre-check exists to avoid a pointless API call, never to decide
whether stock can be sold.

### The Session's expiry is set explicitly, not defaulted

Stripe's default Checkout Session lifetime is **24 hours**. Because
`expires_at` is what the Reservation inherits, defaulting would put a
**day-long hold on the last unit** every time someone opens checkout and walks
away — for a store whose last unit is a common state (ADR 0010's own premise),
that is an inventory outage disguised as a default.

The Session is created with an explicit `expires_at` of **30 minutes**, Stripe's
documented minimum. Long enough to enter a card, short enough that an abandoned
checkout returns the unit while the shopper is still plausibly browsing. Expiry
is computed rather than scheduled (ADR 0010), so the hold stops counting the
moment it lapses, with or without the #30 webhook.

## 2. The RPC adds no new `SECURITY DEFINER` surface

`20260825130000_shrink_definer_surface.sql` deliberately reduced definer objects
to exactly one — `private.variant_available_stock` — in a schema PostgREST does
not expose, because Supabase's linter flags definer objects reachable over REST
(0010, 0028/0029). A new definer function in `public` would undo that.

**`public.reserve_cart` is `SECURITY INVOKER`.** The route calls it with
`SUPABASE_SECRET_KEY`, which bypasses RLS, so the inserts succeed for the server.
`public.reservations` has RLS enabled with deliberately no policies, so the same
call from a browser key inserts nothing.

Belt and braces, because Postgres grants `EXECUTE` on new functions to `PUBLIC`
by default:

```sql
revoke execute on function public.reserve_cart(text, timestamptz, jsonb)
  from public, anon, authenticated;
```

Without the `from public` that revoke is cosmetic — `anon` inherits from the
`PUBLIC` pseudo-role. This is the one line most likely to be dropped as
redundant, and it is the line that matters.

This matches CLAUDE.md: the secret key appears only where bypassing RLS is the
point — the reservation hold (#15) and the webhook (#18).

## 3. The function

```sql
create function public.reserve_cart(
  p_session_id text,
  p_expires_at timestamptz,
  p_items      jsonb   -- [{"variant_id": "...", "quantity": 2}, ...]
) returns table (variant_id uuid, requested integer, available integer)
```

An empty result means the hold succeeded. A non-empty result names every line
that could not be filled, so the route can say "Knit Sweater / M — you asked for
2, one left" rather than failing opaquely.

**Step 1 — lock, in a deterministic order.**

```sql
perform v.id from public.variants v
where v.id in (select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
order by v.id
for update;
```

`order by v.id` is not decoration. Two carts sharing two Variants, locking them
in opposite orders, deadlock. Ordering by primary key gives every caller the
same sequence.

The Variant row is the serialization point. Reservations are separate rows, so
two shoppers racing the last unit are only serialized because both take this
lock; the second then re-reads `reservations` after the first commits and sees
the new hold.

**Step 2 — compute availability with the locks held, and report shortfalls.**
Availability is computed **inline**, not via `private.variant_available_stock`.
That helper is `stable`, and a `stable` function may reuse a snapshot taken
before the lock was acquired — which would let the second shopper read stale
availability and oversell exactly the unit this design exists to protect.

Two rules in the same query:

- **`left join` to `variants`**, so a `variant_id` matching nothing reports
  `available = 0` and is a shortfall rather than silently vanishing from both
  the check and the insert.
- **Join `products` and treat a Hidden Product as unavailable.** The route's
  price re-read goes through RLS and would already have dropped it, but the RPC
  runs with a key that bypasses RLS, so without this it would happily hold stock
  for a Product the client has hidden.

**Step 3 — all or nothing.** If any line is short, the function has already
returned those rows and inserts nothing. A partial hold is wrong: the Session
carries every line, so a cart we can only half-fill must fail whole.

The insert takes `on conflict (stripe_session_id, variant_id) do nothing`, so a
retried call for the same Session is harmless.

## 4. Route flow

`app/api/checkout/route.ts`, `POST` only.

1. **Validate the body** — `parseCheckoutRequest` in `lib/cart.ts`, beside
   `parseResolveRequest`, so validation stays inside the pure tested seam and
   the handler keeps no logic of its own. Same `MAX_CART_ITEMS` cap and uuid
   check; an empty Cart is a 400. It also **rejects a repeated `variantId`**:
   the Cart merges duplicates on add (`addItem`), so a body carrying the same
   Variant twice is a malformed client — and letting it through would meet
   `on conflict do nothing` in the RPC and hold less stock than the Session
   charges for.
2. **Re-read prices and availability from Supabase.** `getVariantsByIds` already
   returns exactly this, through the publishable key and therefore through RLS.
   **Never trust a price from the browser** — this is the whole reason ADR 0001
   keeps prices out of the Cart.
3. **Advisory availability check** — `reconcile` from `lib/cart.ts`, already the
   tested authority on what "short" and "unavailable" mean. Anything not `ok`
   bails with 409. Not authoritative about stock, deliberately; reusing the
   Cart's own vocabulary is what stops the route and `/cart` disagreeing about
   which line is the problem.
4. **Create the Checkout Session** from live `price_data`.
5. **`reserve_cart(session.id, session.expires_at, items)`.**
6. **Shortfalls** → `stripe.checkout.sessions.expire(session.id)`, return 409
   with the per-line detail. Otherwise return `{ url: session.url }`.

A variant id that resolves to nothing in step 2 fails there as a **409**, before
Stripe is called — not a 400. The Cart is allowed to contain such a row and the
client is not malformed for sending it: a Hidden Product drops out of
`variants_available`, and `lib/cart.ts` deliberately reports it `unavailable`
and keeps it visible rather than mutating the Cart. It simply can never be
checked out, which is an availability answer.

### Status codes

| Code | When |
|---|---|
| 200 | `{ url }` — Session created and stock held |
| 400 | Malformed body: empty Cart, over `MAX_CART_ITEMS`, bad uuid, repeated `variantId` |
| 409 | Cannot be filled — short stock, or a line that no longer resolves (Hidden Product) — with the offending lines named |
| 502 | Stripe unreachable or refused |

## 5. Money

`price_data.unit_amount` is in integer cents, and `lib/cart.ts` already converts
decimal dollars to cents for the subtotal. **Checkout reuses that conversion.**
A second `Math.round(price * 100)` in the route is precisely how `/cart` and the
amount charged come to disagree — the failure ADR 0001's amendment and the
"subtotal computed here and nowhere else" rule exist to prevent.

## 6. Two deployment risks

**The Stripe SDK on workerd.** The Node SDK reaches for `http`, which does not
exist on Cloudflare's runtime; Stripe supports Workers through
`Stripe.createFetchHttpClient()`. CLAUDE.md is explicit that `npm run build`
passing proves nothing about workerd, and that `cf:preview` is not optional.
**Verify through `npm run cf:preview` before merging**, not after.

**The lockfile.** `npm install stripe` triggers CLAUDE.md's npm 10/11 procedure
in full: regenerate with `rm package-lock.json && npx npm@10.9.2 install
--package-lock-only` **after the last install**, then confirm `npm ci --dry-run`
exits 0 under both npm versions. Getting this wrong fails the Cloudflare build
during dependency install, before it reaches a line of app code, with an error
that points nowhere near this repo.

## 7. Testing

TDD is **mandatory** here — CLAUDE.md names the reservation RPC explicitly. Use
the `tdd` skill: failing test first, confirm it fails for the right reason, then
implement.

**Pure, in `lib/cart.test.ts`** (extending the existing suite, not starting a new
one):
- `parseCheckoutRequest` — empty Cart, over-cap, malformed uuid, valid body
- line-item construction from resolved variants → Stripe `price_data`, including
  that `unit_amount` comes from the shared cents conversion
- the advisory pre-check agreeing with `reconcile` about what is short

**Against the real database, in the `db:verify` suite:**
- a hold reduces Available Stock, and a lapsed hold stops reducing it
- an all-or-nothing cart with one short line inserts **zero** rows
- an unknown `variant_id` reports `available = 0` rather than disappearing
- a Hidden Product's Variant cannot be held
- `anon` and `authenticated` cannot execute `reserve_cart` at all
- **two concurrent calls for the last unit: exactly one succeeds.** This is
  issue #15's actual done-when, and the only test that proves the lock ordering
  and the inline availability read are doing their jobs.

No assertion may depend on an exact catalog row count (CLAUDE.md).

## 8. Out of scope

- **#16** — requiring login at checkout. This route does not gate on auth.
- **#19** — `/checkout/success`. The Session gets a `success_url` pointing at it,
  and the page arrives separately.
- **#18** — the webhook that consumes the Reservation and writes the Order.
  Nothing here decrements `variants.stock`; the hold is the whole job.
- **#30** — releasing on `checkout.session.expired`. Expiry is computed (ADR
  0010), so a lapsed hold already stops holding stock without it.
