# Checkout Session and Reservation Hold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/checkout` turns a Cart into a Stripe-hosted Checkout Session and atomically holds the stock behind it, so two shoppers can never both buy the last unit.

**Architecture:** The route creates the Stripe Session first, then calls one Postgres function that locks the Variant rows, checks Available Stock, and inserts every Reservation or none. A shortfall expires the Session and returns 409 before the shopper ever sees a payment link. All request validation and money math live as pure functions in `lib/cart.ts`, so they are tested without a browser or a database; the handler holds no logic of its own.

**Tech Stack:** Next.js 16 App Router (route handler), Stripe Node SDK on Cloudflare workerd via `createFetchHttpClient`, Supabase/PostgREST RPC, Vitest 3 (node), plain `fetch` for the database suite.

**Spec:** [`docs/superpowers/specs/2026-09-13-checkout-session-design.md`](../specs/2026-09-13-checkout-session-design.md) — read it before Task 1. It carries the reasoning; this plan carries the steps.

## Global Constraints

- **TDD is mandatory here.** CLAUDE.md names the reservation check-and-hold RPC explicitly. Failing test first, confirm it fails for the right reason, then implement.
- **`lib/cart.ts` imports nothing.** Availability arrives as a plain argument. Do not add an import to it, not even a type-only one — declare the shapes locally.
- **The subtotal and every cents conversion happen in `lib/cart.ts` and nowhere else.** No `Math.round(price * 100)` anywhere else in the codebase.
- **Never trust a price from the browser.** Prices are re-read from Supabase inside the route.
- **`SUPABASE_SECRET_KEY` never reaches a client component and never gets a `NEXT_PUBLIC_` prefix.**
- **No new `SECURITY DEFINER` objects in `public`.** `20260825130000_shrink_definer_surface.sql` deliberately reduced the definer surface to one function in the unexposed `private` schema.
- **After the last `npm install`, regenerate the lockfile with npm 10**: `rm package-lock.json && npx npm@10.9.2 install --package-lock-only`, then `npm ci --dry-run` must exit 0 under npm 10 **and** npm 11.
- **Do not run `npm run build`, `npm run cf:build`, or `npm run cf:preview` while `npm run dev` is running.** They rewrite `.next` underneath it.
- **No test may assert an exact catalog row count.** Floors, runtime baselines, or the property itself.
- **`npm run lint` must stay at 6 warnings, 0 errors.**
- **Currency is `usd`** — matches the `$X.XX` the storefront already renders (`app/cart/page.tsx:31`). ⚠️ **Confirm with Kaung before Task 3 is committed.** No ADR or CONTEXT.md entry records this; if SSUNI bills in CAD/AUD/SGD, `CHECKOUT_CURRENCY` is the single line to change.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/cart.ts` (modify) | Adds `parseCheckoutRequest`, `CheckoutVariant`, `CheckoutLineItem`, `toStripeLineItems`, `CHECKOUT_CURRENCY`. Stays pure and import-free. |
| `lib/cart.test.ts` (modify) | Extends the existing suite. No new test file. |
| `lib/stripe.ts` (create) | Builds the Stripe client with the fetch HTTP client so it works on workerd. Server-only. |
| `supabase/migrations/20260913130000_reserve_cart.sql` (create) | `public.reserve_cart`, its grants, and its revokes. |
| `supabase/tests/rls.mjs` (modify) | RPC behaviour against the real database, including the concurrency race. |
| `app/api/checkout/route.ts` (create) | The handler. Thin: validate → resolve → pre-check → Session → reserve → respond. |
| `app/cart/page.tsx` (modify) | The Checkout button stops being inert. |
| `lib/database.types.ts` (regenerate) | `npm run db:types` after the migration. |

---

## Task 1: Add Stripe and settle the lockfile

Its own task because the lockfile procedure is independently verifiable and independently rejectable — and because getting it wrong fails the Cloudflare build during dependency install, with an error pointing nowhere near this repo.

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Confirm the dev server is not running**

```bash
netstat -ano | grep ":3000" || echo "port 3000 free"
```

If something holds it, stop it. On Windows, killing the `npm` wrapper often leaves the `node` child alive — confirm the port is actually free.

- [ ] **Step 2: Install Stripe**

```bash
npm install stripe
```

- [ ] **Step 3: Regenerate the lockfile with npm 10**

This must be the **last** install of the session. If a later task needs another package, come back and redo this step afterwards.

```bash
rm package-lock.json && npx npm@10.9.2 install --package-lock-only
```

The `rm` is required — with a lockfile present, npm 10 dies with `Cannot read properties of null (reading 'edgesOut')`.

- [ ] **Step 4: Verify under both npm versions**

```bash
npm ci --dry-run                      # npm 11 (local default)
npx npm@10.9.2 ci --dry-run           # npm 10.9.2 (what Cloudflare runs)
```

Expected: both exit 0. If npm 10 reports `Missing: @emnapi/runtime from lock file` or "package.json and package-lock.json are not in sync", Step 3 did not take — redo it and do not proceed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add the Stripe SDK, lockfile regenerated under npm 10"
```

---

## Task 2: `parseCheckoutRequest`

**Files:**
- Modify: `lib/cart.ts`
- Test: `lib/cart.test.ts`

**Interfaces:**
- Consumes: `CartItem`, `MAX_CART_ITEMS`, the module-private `UUID` regex — all already in `lib/cart.ts`.
- Produces: `parseCheckoutRequest(body: unknown): CartItem[] | null`.

Note how this deliberately differs from the neighbouring `parseResolveRequest`, which **drops** malformed ids and tolerates duplicates. Resolve is a display path, so it degrades to "this piece is no longer available". Checkout is a money path, so it refuses. Say so in the doc comment.

- [ ] **Step 1: Write the failing tests**

Append to `lib/cart.test.ts`:

```ts
describe("parseCheckoutRequest", () => {
  const id = (n: number) => `0a7b617d-f5b2-4296-8d0d-cda1786050${String(n).padStart(2, "0")}`;

  it("accepts a well-formed cart", () => {
    expect(
      parseCheckoutRequest({ items: [{ variantId: id(1), quantity: 2 }] }),
    ).toEqual([{ variantId: id(1), quantity: 2 }]);
  });

  it("rejects an empty cart", () => {
    expect(parseCheckoutRequest({ items: [] })).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseCheckoutRequest(null)).toBeNull();
    expect(parseCheckoutRequest("nope")).toBeNull();
  });

  it("rejects a missing or non-array items field", () => {
    expect(parseCheckoutRequest({})).toBeNull();
    expect(parseCheckoutRequest({ items: "x" })).toBeNull();
  });

  it("rejects more items than the cap", () => {
    const items = Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => ({
      variantId: id(i % 90),
      quantity: 1,
    }));
    expect(parseCheckoutRequest({ items })).toBeNull();
  });

  it("rejects a malformed uuid rather than dropping it", () => {
    expect(parseCheckoutRequest({ items: [{ variantId: "nope", quantity: 1 }] })).toBeNull();
  });

  it("rejects a non-positive or non-integer quantity", () => {
    expect(parseCheckoutRequest({ items: [{ variantId: id(1), quantity: 0 }] })).toBeNull();
    expect(parseCheckoutRequest({ items: [{ variantId: id(1), quantity: -1 }] })).toBeNull();
    expect(parseCheckoutRequest({ items: [{ variantId: id(1), quantity: 1.5 }] })).toBeNull();
  });

  it("rejects a repeated variantId", () => {
    expect(
      parseCheckoutRequest({
        items: [
          { variantId: id(1), quantity: 1 },
          { variantId: id(1), quantity: 2 },
        ],
      }),
    ).toBeNull();
  });
});
```

Add `parseCheckoutRequest` to the existing import at the top of `lib/cart.test.ts`.

- [ ] **Step 2: Run the tests and confirm they fail for the right reason**

```bash
npm test -- lib/cart.test.ts
```

Expected: failures reading `parseCheckoutRequest is not a function` — not a syntax or import error elsewhere.

- [ ] **Step 3: Implement**

Append to `lib/cart.ts`, next to `parseResolveRequest`:

```ts
/**
 * Validate a POST /api/checkout body, returning the Cart Items to charge for or
 * null if this is not a request we are willing to serve.
 *
 * Deliberately stricter than parseResolveRequest above, which drops malformed
 * ids and tolerates duplicates. That one feeds a display: degrading to "this
 * piece is no longer available" is kinder than failing the whole Cart. This one
 * feeds a charge, where quietly buying a subset of what was asked for is worse
 * than refusing.
 *
 * A repeated variantId is rejected rather than merged. The Cart merges on add
 * (see addItem), so a duplicate means a broken client -- and if it reached the
 * hold, `on conflict do nothing` would reserve one line's worth of stock while
 * the Session charged for two.
 */
export function parseCheckoutRequest(body: unknown): CartItem[] | null {
  if (typeof body !== "object" || body === null) return null;

  const { items } = body as { items?: unknown };
  if (!Array.isArray(items)) return null;
  if (items.length === 0 || items.length > MAX_CART_ITEMS) return null;

  const parsed: CartItem[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) return null;
    const { variantId, quantity } = raw as { variantId?: unknown; quantity?: unknown };

    if (typeof variantId !== "string" || !UUID.test(variantId)) return null;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) return null;
    if (seen.has(variantId)) return null;

    seen.add(variantId);
    parsed.push({ variantId, quantity });
  }

  return parsed;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test -- lib/cart.test.ts
```

Expected: all pass, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/cart.ts lib/cart.test.ts
git commit -m "feat: validate the checkout request body (#15)"
```

---

## Task 3: `toStripeLineItems`

**Files:**
- Modify: `lib/cart.ts`
- Test: `lib/cart.test.ts`

**Interfaces:**
- Consumes: `CartItem`, `VariantAvailability`, the module-private `toCents`.
- Produces: `CHECKOUT_CURRENCY`, `CheckoutVariant`, `CheckoutLineItem`, `toStripeLineItems(items, variants)`.

⚠️ Confirm the currency (Global Constraints) before committing this task.

- [ ] **Step 1: Write the failing tests**

Append to `lib/cart.test.ts`:

```ts
describe("toStripeLineItems", () => {
  const vid = "0a7b617d-f5b2-4296-8d0d-cda178605c80";

  const variant = {
    price: 19.99,
    availableStock: 10,
    productName: "Rabbit Hole Hoodie",
    color: "Espresso",
    size: "M",
    imageUrl: "https://example.test/hoodie.jpg",
  };

  it("converts dollars to integer cents", () => {
    const [line] = toStripeLineItems([{ variantId: vid, quantity: 3 }], { [vid]: variant });
    expect(line.price_data.unit_amount).toBe(1999);
    expect(line.quantity).toBe(3);
  });

  it("never emits a fractional cent", () => {
    // 19.99 * 3 is 59.97000000000001 in binary floating point. Stripe rejects a
    // non-integer unit_amount, and the tail would otherwise reach the charge.
    const [line] = toStripeLineItems(
      [{ variantId: vid, quantity: 3 }],
      { [vid]: { ...variant, price: 19.99 } },
    );
    expect(Number.isInteger(line.price_data.unit_amount)).toBe(true);
  });

  it("names the line with the product, colour and size", () => {
    const [line] = toStripeLineItems([{ variantId: vid, quantity: 1 }], { [vid]: variant });
    expect(line.price_data.product_data.name).toBe("Rabbit Hole Hoodie — Espresso / M");
  });

  it("omits images entirely when there is no image", () => {
    const [line] = toStripeLineItems(
      [{ variantId: vid, quantity: 1 }],
      { [vid]: { ...variant, imageUrl: null } },
    );
    expect(line.price_data.product_data.images).toBeUndefined();
  });

  it("skips a variant absent from the map rather than pricing it at zero", () => {
    expect(toStripeLineItems([{ variantId: vid, quantity: 1 }], {})).toEqual([]);
  });

  it("agrees with reconcile about the total", () => {
    const items = [{ variantId: vid, quantity: 2 }];
    const lines = toStripeLineItems(items, { [vid]: variant });
    const stripeTotal = lines.reduce((n, l) => n + l.price_data.unit_amount * l.quantity, 0);
    expect(stripeTotal).toBe(Math.round(reconcile(items, { [vid]: variant }).subtotal * 100));
  });
});
```

Add `toStripeLineItems` to the import at the top of the test file.

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npm test -- lib/cart.test.ts
```

Expected: `toStripeLineItems is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/cart.ts`:

```ts
// ---------------------------------------------------------------------------
// Checkout line items (#15)
// ---------------------------------------------------------------------------

/**
 * Confirmed against the $X.XX the storefront renders. No ADR records this; if
 * SSUNI ever bills in another currency, this is the only line to change.
 */
export const CHECKOUT_CURRENCY = "usd";

/** Everything checkout needs to describe one line to Stripe. */
export type CheckoutVariant = VariantAvailability & {
  productName: string;
  color: string;
  size: string;
  imageUrl: string | null;
};

/** One Stripe `price_data` line. Structural, so this module still imports nothing. */
export type CheckoutLineItem = {
  price_data: {
    currency: string;
    unit_amount: number;
    product_data: { name: string; images?: string[] };
  };
  quantity: number;
};

/**
 * Build Stripe line items from live catalog data (ADR 0008: inline price_data,
 * never a mirrored Stripe catalog).
 *
 * `unit_amount` goes through the same toCents as the subtotal, on purpose. A
 * second rounding here is how the Cart and the amount charged come to differ by
 * a cent, and a cent is enough for a customer to notice and not trust you.
 *
 * A Variant absent from the map is skipped rather than priced at zero -- the
 * route has already refused such a Cart with a 409, and a zero-price line would
 * read as a free gift if that check were ever weakened.
 */
export function toStripeLineItems(
  items: CartItem[],
  variants: Record<string, CheckoutVariant>,
): CheckoutLineItem[] {
  const lines: CheckoutLineItem[] = [];

  for (const item of items) {
    const variant = variants[item.variantId];
    if (!variant) continue;

    lines.push({
      price_data: {
        currency: CHECKOUT_CURRENCY,
        unit_amount: toCents(variant.price),
        product_data: {
          name: `${variant.productName} — ${variant.color} / ${variant.size}`,
          ...(variant.imageUrl ? { images: [variant.imageUrl] } : {}),
        },
      },
      quantity: item.quantity,
    });
  }

  return lines;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test
```

Expected: the whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/cart.ts lib/cart.test.ts
git commit -m "feat: build Stripe line items from live catalog prices (#15)"
```

---

## Task 4: The `reserve_cart` function and its database tests

The correctness heart of the issue. Written test-first against the real database, because what matters is what Postgres does under concurrency, which no unit test can tell you.

**Files:**
- Create: `supabase/migrations/20260913130000_reserve_cart.sql`
- Modify: `supabase/tests/rls.mjs`
- Regenerate: `lib/database.types.ts`

**Interfaces:**
- Produces: `public.reserve_cart(p_session_id text, p_expires_at timestamptz, p_items jsonb) returns table (variant_id uuid, requested integer, available integer)`. An **empty result means success**. Called over PostgREST as `POST /rest/v1/rpc/reserve_cart`.

- [ ] **Step 1: Write the failing database tests**

Append to `supabase/tests/rls.mjs`, before its final summary block. It already defines `anon`, `svc`, and `check(name, ok, detail)` — reuse them, do not redefine.

```js
// ---------------------------------------------------------------------------
// reserve_cart (#15, ADR 0010)
// ---------------------------------------------------------------------------

const rpc = (key, body) =>
  req(key, "POST", "rpc/reserve_cart", { body });

const inThirtyMinutes = () => new Date(Date.now() + 30 * 60_000).toISOString();

// A Variant to experiment on, and its real stock so we can put it back.
const testVariant = (await svc("GET", "variants?select=id,stock&limit=1")).json?.[0];
if (!testVariant) throw new Error("no variants in the database to test reserve_cart against");
const restoreStock = () =>
  svc("PATCH", `variants?id=eq.${testVariant.id}`, { body: { stock: testVariant.stock } });
const clearHolds = (sessionPrefix) =>
  svc("DELETE", `reservations?stripe_session_id=like.${sessionPrefix}*`);

// -- the browser must not be able to call it at all -------------------------
const anonCall = await rpc(ANON, {
  p_session_id: "cs_test_anon",
  p_expires_at: inThirtyMinutes(),
  p_items: [{ variant_id: testVariant.id, quantity: 1 }],
});
check("anon cannot execute reserve_cart", anonCall.status !== 200, `status ${anonCall.status}`);

// -- a satisfiable hold succeeds and reduces Available Stock ----------------
await svc("PATCH", `variants?id=eq.${testVariant.id}`, { body: { stock: 5 } });

const ok = await rpc(SERVICE, {
  p_session_id: "cs_test_ok_1",
  p_expires_at: inThirtyMinutes(),
  p_items: [{ variant_id: testVariant.id, quantity: 2 }],
});
check("a satisfiable hold returns no shortfalls", ok.status === 200 && ok.json?.length === 0,
  JSON.stringify(ok.json));

const afterHold = (await svc("GET", `variants_available?select=available_stock&id=eq.${testVariant.id}`)).json?.[0];
check("Available Stock drops by the held quantity", afterHold?.available_stock === 3,
  JSON.stringify(afterHold));

// -- all or nothing ---------------------------------------------------------
const tooMany = await rpc(SERVICE, {
  p_session_id: "cs_test_short_1",
  p_expires_at: inThirtyMinutes(),
  p_items: [{ variant_id: testVariant.id, quantity: 99 }],
});
check("an unsatisfiable hold reports the shortfall", tooMany.json?.[0]?.available === 3,
  JSON.stringify(tooMany.json));

const shortRows = (await svc("GET", "reservations?select=id&stripe_session_id=eq.cs_test_short_1")).json ?? [];
check("an unsatisfiable hold inserts nothing", shortRows.length === 0, JSON.stringify(shortRows));

// -- an unknown Variant is a shortfall, not a silent skip -------------------
const ghost = await rpc(SERVICE, {
  p_session_id: "cs_test_ghost_1",
  p_expires_at: inThirtyMinutes(),
  p_items: [{ variant_id: "00000000-0000-4000-8000-000000000000", quantity: 1 }],
});
check("an unknown variant reports available 0", ghost.json?.[0]?.available === 0,
  JSON.stringify(ghost.json));

// -- the race: two shoppers, one unit ---------------------------------------
await clearHolds("cs_test_");
await svc("PATCH", `variants?id=eq.${testVariant.id}`, { body: { stock: 1 } });

const [raceA, raceB] = await Promise.all([
  rpc(SERVICE, { p_session_id: "cs_test_race_a", p_expires_at: inThirtyMinutes(),
                 p_items: [{ variant_id: testVariant.id, quantity: 1 }] }),
  rpc(SERVICE, { p_session_id: "cs_test_race_b", p_expires_at: inThirtyMinutes(),
                 p_items: [{ variant_id: testVariant.id, quantity: 1 }] }),
]);

const winners = [raceA, raceB].filter((r) => r.status === 200 && r.json?.length === 0).length;
check("exactly one of two concurrent shoppers gets the last unit", winners === 1,
  `winners=${winners} a=${JSON.stringify(raceA.json)} b=${JSON.stringify(raceB.json)}`);

// -- put the database back --------------------------------------------------
await clearHolds("cs_test_");
await restoreStock();
const restored = (await svc("GET", `variants?select=stock&id=eq.${testVariant.id}`)).json?.[0];
check("test stock restored", restored?.stock === testVariant.stock, JSON.stringify(restored));
```

- [ ] **Step 2: Run the suite and confirm it fails for the right reason**

```bash
npm run db:verify
```

Expected: the new checks fail because the function does not exist (PostgREST 404 on `rpc/reserve_cart`). The pre-existing checks must all still pass — if they do not, stop and fix that first.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260913130000_reserve_cart.sql`:

```sql
-- Atomic check-and-hold for checkout. Issue #15, ADR 0010.
--
-- Reading Available Stock in TypeScript and then inserting a Reservation
-- narrows the oversell race without closing it. The check and the insert have
-- to happen under one lock, which is what this function is for.
--
-- SECURITY INVOKER, deliberately. 20260825130000_shrink_definer_surface.sql cut
-- the definer surface down to a single function in the unexposed `private`
-- schema, because Supabase's linter flags definer objects reachable over REST.
-- This function does not need definer rights: the route calls it with
-- SUPABASE_SECRET_KEY, which bypasses RLS, and public.reservations has RLS on
-- with deliberately no policies, so the same call from a browser key inserts
-- nothing. The revokes below make that belt-and-braces.

create or replace function public.reserve_cart(
  p_session_id text,
  p_expires_at timestamptz,
  p_items      jsonb
)
returns table (variant_id uuid, requested integer, available integer)
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  -- Lock every requested Variant row, in primary-key order.
  --
  -- The ordering is load-bearing. Two Carts sharing two Variants and locking
  -- them in opposite orders deadlock; ordering by id gives every caller the
  -- same sequence. The Variant row is also the serialization point for the
  -- whole operation -- Reservations are separate rows, so two shoppers racing
  -- the last unit only serialize because both take this lock.
  perform v.id
  from public.variants v
  where v.id in (
    select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i
  )
  order by v.id
  for update;

  -- With the locks held, compute Available Stock and report every short line.
  --
  -- Availability is computed inline rather than through
  -- private.variant_available_stock, which is STABLE and may reuse a snapshot
  -- taken before the lock was acquired -- handing the second shopper stale
  -- availability and overselling the exact unit this exists to protect.
  --
  -- left join, so a variant_id matching nothing reports available 0 and is a
  -- shortfall rather than vanishing from both the check and the insert.
  --
  -- The products join makes a Hidden Product unavailable. The route's price
  -- re-read goes through RLS and would already have dropped it, but this
  -- function runs under a key that bypasses RLS, so without this it would hold
  -- stock for a Product the client has hidden.
  return query
  with req as (
    select (i->>'variant_id')::uuid  as vid,
           (i->>'quantity')::integer as qty
    from jsonb_array_elements(p_items) i
  ),
  avail as (
    select
      r.vid,
      r.qty,
      case
        when v.id is null or p.is_hidden then 0
        else greatest(
          v.stock - coalesce((
            select sum(res.quantity)
            from public.reservations res
            where res.variant_id = r.vid
              and res.status = 'held'
              and res.expires_at > now()
          ), 0),
          0
        )
      end::integer as available
    from req r
    left join public.variants v on v.id = r.vid
    left join public.products p on p.id = v.product_id
  )
  select a.vid, a.qty, a.available
  from avail a
  where a.available < a.qty;

  -- RETURN QUERY sets FOUND. Anything short means we have already returned the
  -- shortfalls and insert nothing: the Session carries every line, so a Cart we
  -- can only half-fill must fail whole.
  if found then
    return;
  end if;

  insert into public.reservations (variant_id, quantity, stripe_session_id, expires_at)
  select (i->>'variant_id')::uuid, (i->>'quantity')::integer, p_session_id, p_expires_at
  from jsonb_array_elements(p_items) i
  on conflict (stripe_session_id, variant_id) do nothing;
end;
$$;

comment on function public.reserve_cart(text, timestamptz, jsonb) is
  'Atomic check-and-hold for one Cart (ADR 0010). Returns one row per line that cannot be filled; an empty result means every Reservation was inserted. Callable only with the secret key -- see the revokes below.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and anon
-- inherits from PUBLIC. Without `from public` this revoke is cosmetic.
revoke execute on function public.reserve_cart(text, timestamptz, jsonb)
  from public, anon, authenticated;
```

- [ ] **Step 4: Apply it and run the suite**

```bash
npm run db:push
npm run db:verify
```

Expected: every new check passes, including `exactly one of two concurrent shoppers gets the last unit`. The advisor must report only its two known findings (`rls_auto_enable` ×2 and leaked-password protection) — **anything else is a real finding**, including any new `SECURITY DEFINER` complaint.

If the race check reports `winners=2`, the lock is not doing its job — do not weaken the test. Re-read Step 3's `for update` and the inline availability computation.

- [ ] **Step 5: Regenerate the database types**

```bash
npm run db:types
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260913130000_reserve_cart.sql supabase/tests/rls.mjs lib/database.types.ts
git commit -m "feat: atomic check-and-hold for checkout (#15, ADR 0010)"
```

---

## Task 5: The Stripe client and the route

**Files:**
- Create: `lib/stripe.ts`, `app/api/checkout/route.ts`

**Interfaces:**
- Consumes: `parseCheckoutRequest`, `toStripeLineItems`, `reconcile`, `CheckoutVariant` (Task 2/3); `getVariantsByIds` from `lib/catalog.ts`; `public.reserve_cart` (Task 4).
- Produces: `POST /api/checkout` → `200 {url}` | `400 {error}` | `409 {error, lines}` | `502 {error}`.

- [ ] **Step 1: Create the Stripe client**

`lib/stripe.ts`:

```ts
import Stripe from "stripe";

/**
 * The Stripe client, built for the runtime this site actually deploys to.
 *
 * `createFetchHttpClient` is not optional here. The SDK's default HTTP client
 * reaches for Node's `http` module, which does not exist on Cloudflare's
 * workerd -- so the default builds fine, passes `npm run dev`, and fails only
 * under `npm run cf:preview`. See CLAUDE.md on why cf:preview is the gate.
 *
 * Server-only: SUPABASE_SECRET_KEY and STRIPE_SECRET_KEY must never reach a
 * client component.
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");

  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * How long a Checkout Session -- and therefore the Reservation behind it --
 * stays alive. Stripe's documented minimum.
 *
 * Stripe defaults to 24 hours. Because the Reservation inherits this, the
 * default would put a day-long hold on the last unit every time someone opened
 * checkout and wandered off.
 */
export const CHECKOUT_TTL_SECONDS = 30 * 60;
```

- [ ] **Step 2: Create the route**

`app/api/checkout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  parseCheckoutRequest,
  reconcile,
  toStripeLineItems,
  type CheckoutVariant,
} from "@/lib/cart";
import { getVariantsByIds } from "@/lib/catalog";
import { CHECKOUT_TTL_SECONDS, getStripe } from "@/lib/stripe";

/**
 * Turn a Cart into a Stripe-hosted Checkout Session, and hold the stock behind
 * it. Issue #15, per ADR 0008 (hosted Checkout, inline price_data) and ADR 0010
 * (reserve at session creation, atomically).
 *
 * The Session is created before the hold so the Reservation carries Stripe's
 * real session id and expiry -- the unique index on
 * (stripe_session_id, variant_id) is what makes #18 idempotent, and it should
 * never be enforcing uniqueness over a placeholder. If the hold then fails, the
 * Session is expired and the shopper never receives the URL.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const items = parseCheckoutRequest(body);
  if (items === null) {
    return NextResponse.json(
      { error: "Expected { items: [{ variantId, quantity }] }." },
      { status: 400 },
    );
  }

  // Prices come from the database, never from the browser (ADR 0001/0008).
  const resolved = await getVariantsByIds(items.map((i) => i.variantId));

  const variants: Record<string, CheckoutVariant> = Object.fromEntries(
    resolved.map((v) => [
      v.variantId,
      {
        price: v.price,
        availableStock: v.availableStock,
        productName: v.productName,
        color: v.color,
        size: v.size,
        imageUrl: v.imageUrl,
      },
    ]),
  );

  // Advisory only. ADR 0010 is explicit that the RPC below is the sole
  // authority on whether stock can be sold; this exists so a Cart that is
  // already hopeless does not cost a Stripe API call. It reuses `reconcile` so
  // the route and /cart cannot disagree about which line is the problem.
  const preflight = reconcile(items, variants);
  const blocked = preflight.items.filter((i) => i.status !== "ok");
  if (blocked.length > 0) {
    return NextResponse.json(
      { error: "Some items are no longer available.", lines: blocked },
      { status: 409 },
    );
  }

  const origin = new URL(request.url).origin;
  const stripe = getStripe();

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: toStripeLineItems(items, variants),
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
    });
  } catch {
    return NextResponse.json({ error: "Could not reach Stripe." }, { status: 502 });
  }

  // The hold bypasses RLS, so it uses the secret key -- the only place besides
  // the webhook (#18) where that is true.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: shortfalls, error } = await admin.rpc("reserve_cart", {
    p_session_id: session.id,
    p_expires_at: new Date(session.expires_at * 1000).toISOString(),
    p_items: items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
  });

  if (error || (shortfalls ?? []).length > 0) {
    // Nobody has the URL, so expiring is tidiness rather than a race to win.
    // If it fails, the Session lapses on its own in 30 minutes.
    await stripe.checkout.sessions.expire(session.id).catch(() => {});

    if (error) {
      return NextResponse.json({ error: "Could not hold stock." }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Some items sold out while you were checking out.", lines: shortfalls },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { url: session.url },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

- [ ] **Step 3: Check it compiles and lints**

```bash
npx tsc --noEmit
npm run lint
```

Expected: no type errors; lint still 6 warnings, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add lib/stripe.ts app/api/checkout/route.ts
git commit -m "feat: POST /api/checkout creates a Session and holds stock (#15)"
```

---

## Task 6: Make the Checkout button live

**Files:**
- Modify: `app/cart/page.tsx` (the inert button is around line 185–191)

**Interfaces:**
- Consumes: `POST /api/checkout` from Task 5.

- [ ] **Step 1: Read the current button and its surroundings**

```bash
sed -n '150,200p' app/cart/page.tsx
```

Note how the page already holds the Cart Items and the resolved variants — reuse that state rather than re-fetching.

- [ ] **Step 2: Wire it up**

Replace the inert button with a handler that posts the Cart and follows the returned URL. Keep the existing Tailwind classes exactly as they are; add a pending state so a double click cannot create two Sessions and two holds.

```tsx
const [checkoutError, setCheckoutError] = useState<string | null>(null);
const [checkingOut, setCheckingOut] = useState(false);

async function startCheckout() {
  setCheckingOut(true);
  setCheckoutError(null);
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();

    if (!res.ok) {
      setCheckoutError(data.error ?? "Checkout is unavailable right now.");
      setCheckingOut(false);
      return;
    }
    // Leaving the origin for Stripe's hosted page (ADR 0008).
    window.location.href = data.url;
  } catch {
    setCheckoutError("Checkout is unavailable right now.");
    setCheckingOut(false);
  }
}
```

The button gains `onClick={startCheckout}` and `disabled={checkingOut || items.length === 0}`, and `checkoutError` renders beneath it.

`items` must be the raw `CartItem[]` — `{variantId, quantity}` only. Do not send prices; the route re-reads them and would ignore them anyway.

- [ ] **Step 3: Verify by hand against the dev server**

```bash
npm run dev
```

Add something to the Cart, press Checkout, and confirm you land on a Stripe-hosted page showing the right line items and total. Use test card `4242 4242 4242 4242`, any future expiry, any CVC.

Then confirm the hold actually happened:

```bash
node -e "const{readFileSync}=require('fs');const e=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));fetch(e.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/reservations?select=*&order=created_at.desc&limit=3',{headers:{apikey:e.SUPABASE_SECRET_KEY,Authorization:'Bearer '+e.SUPABASE_SECRET_KEY}}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
```

Expected: a `held` row per line, with `expires_at` about 30 minutes out.

- [ ] **Step 4: Commit**

```bash
git add app/cart/page.tsx
git commit -m "feat: the Cart's Checkout button starts a Session (#15)"
```

---

## Task 7: Prove it on the runtime it deploys to

The Stripe SDK is the exact class of dependency that works under `next dev` and fails under workerd. CLAUDE.md: a green `npm run build` is not evidence.

- [ ] **Step 1: Stop the dev server and confirm the port is free**

```bash
netstat -ano | grep ":3000" || echo "port 3000 free"
```

`cf:preview` rewrites `.next` while `next dev` reads it, and the resulting failures look like a bug in whatever you last edited.

- [ ] **Step 2: Build and serve on workerd**

```bash
npm run cf:preview
```

Expected: the build completes and the worker serves. If it fails on a missing Node builtin (`http`, `https`, `stream`), the `createFetchHttpClient` in `lib/stripe.ts` is not taking effect — fix that rather than adding a `nodejs_compat` flag to work around it.

- [ ] **Step 3: Run the whole checkout on the preview**

Add to Cart, press Checkout, reach Stripe's page, and confirm a `held` Reservation lands. This is issue #15's done-when.

- [ ] **Step 4: Run every gate**

```bash
npm test
npm run lint
npm run db:verify
npx tsc --noEmit
```

Expected: tests green; lint 6 warnings / 0 errors; `db:verify` green with only its two known advisor findings.

- [ ] **Step 5: Commit anything outstanding and open the PR**

```bash
git status --short
git push -u origin feat/checkout-session
gh pr create --base main --title "feat: checkout session and reservation hold (#15)" --body "..."
```

Do **not** merge — Kaung reviews and merges.

---

## Self-review notes

Checked against the spec, section by section:

- Ordering (spec §1) → Task 5, Step 2
- 30-minute expiry (spec §1) → `CHECKOUT_TTL_SECONDS`, Task 5 Step 1
- No new definer surface, revoke from PUBLIC (spec §2) → Task 4, Step 3
- Lock ordering, inline availability, left join, Hidden Product, all-or-nothing, `on conflict` (spec §3) → Task 4, Step 3, each with the reasoning in the SQL comments
- Route flow and status codes (spec §4) → Task 5, Step 2
- Shared cents conversion (spec §5) → Task 3
- workerd and the lockfile (spec §6) → Tasks 1 and 7
- Every test the spec names (spec §7) → Tasks 2, 3, 4
- Out of scope (spec §8) → nothing here touches #16, #18, #19 or #30

**One open decision the plan cannot make:** the currency. See Global Constraints.
