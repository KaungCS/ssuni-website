# Guest-local cart, login only at checkout

Supabase auth (OTP) already exists in the app, so tying the Cart to a logged-in account was the obvious default. We chose instead to keep the Cart entirely client-side (not persisted to any account) and only require login when the shopper proceeds to checkout. This ships a working add-to-cart experience immediately, without first building server-side cart persistence and account-linking logic, keeping browsing frictionless for anonymous shoppers under a hard end-of-September launch deadline.

## Consequences

Migrating to an account-bound cart later requires merge logic for local cart → account cart at login.

## Amendment, 2026-09-08: a Cart Item stores a reference, never a price

Implementing the Cart (#12) forced a second decision this one had left open: *what* the browser stores per line. A **Cart Item** holds `{variantId, quantity}` and nothing else. It does not store the name, the price, the image, or the stock count.

The alternative — snapshotting the Product's details at the moment of adding — renders `/cart` with no server round trip and works offline, and was rejected because of what it does to money. ADR 0008 has checkout building Stripe `price_data` **dynamically from the Supabase rows**, so the amount actually charged is always the live database price. A snapshot means the Cart can display \$40 while Stripe charges \$45, with nothing in the system detecting the disagreement. That is not stale data; it is a pricing lie in the one place a storefront cannot afford one. Available Stock has the same property — ADR 0010 makes it inherently live — so it has to be re-read regardless.

The consequence is that **a "local" Cart still needs the server to render**. `/cart` is a client component, because the Cart lives in `localStorage`; it therefore cannot import `lib/catalog.ts`, which reaches `next/headers`. Resolution goes through **`POST /api/cart/resolve`**, which returns *facts* — the resolved Variant, its Product, and its Available Stock — and never verdicts. POST rather than GET specifically so no layer can cache a response carrying live prices and stock.

Deciding what those facts mean is `lib/cart.ts`, which is pure, takes availability as a plain argument, and owns the subtotal. **The subtotal is computed in exactly one place**, or `/cart` and checkout will eventually disagree about what something costs. A variant id that resolves to nothing simply comes back absent, which the same function reports as unavailable — so a Product the client hides in Supabase Studio, which drops out of `variants_available` by definition, needs no special case.

The Cart **never silently mutates itself**. Quantities are clamped at add-time as a convenience, conflicts are *shown* on `/cart` rather than quietly corrected, and an unavailable Cart Item stays visible and excluded from the subtotal instead of being deleted — silently deleting it is how a shopper checks out believing they bought something they did not. None of this is a correctness gate: the atomic check-and-hold of ADR 0010 remains the only authority on whether stock can actually be sold.
