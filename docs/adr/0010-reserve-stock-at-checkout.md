# Reserve Variant stock at checkout, and derive availability from unexpired Reservations

Variants carry a stock count, but nothing in the system reduced it, and the obvious place to do so is the Stripe webhook — after payment succeeds. That leaves a window in which two shoppers can both pay for the last unit, and the store discovers it only when the second Order arrives. Accepting that and refunding by hand was considered and rejected: the catalog is small enough that the last unit of a Variant is a common state rather than an edge case, and "we took your money for something we don't have" is the worst first impression a new storefront can make.

We chose to place a **Reservation** on the Variant when the Stripe Checkout Session is created, consume it into a real stock decrement when payment completes, and let it expire otherwise. Availability shown to shoppers is **Available Stock** — the stock count minus unexpired Reservations.

Two details carry the correctness of this, and both are easy to get wrong:

**The check-and-hold must be atomic, in the database.** Reading availability in TypeScript and then inserting a Reservation reintroduces the exact race this ADR exists to close, just narrowed. The check and the insert happen inside a Postgres function with row-level locking, called as a single RPC.

**Expiry is computed, not scheduled.** Availability counts only Reservations whose `expires_at` is still in the future, so a Reservation that is never explicitly released stops holding stock the moment it lapses. This means a missed `checkout.session.expired` webhook can never permanently leak inventory — the failure mode of a cron-based release, which silently strands stock until someone notices. A sweep that marks lapsed rows `released` is then housekeeping for the sake of tidy data, not a load-bearing job.

## Consequences

This is roughly an extra day in week 4 that the September roadmap did not originally budget, on the critical path between checkout and the webhook — accepted deliberately, with the schedule pressure landing on the Hero Slots and Orders admin work that sits below it in the cut order.

Stock is now written in two places (Reservation creation and webhook consumption) rather than one, so the webhook must consume the Reservation and decrement together and stay idempotent across Stripe's retries. Every surface that displays stock — the "Few Left" and out-of-stock states on the product detail page — must read Available Stock rather than the raw count, or it will offer units that are already held. The client reading `variants.stock` directly in Supabase Studio will see the physical count, which is the number they want for restocking but not the number the storefront is showing; that difference needs saying out loud when they are trained.
