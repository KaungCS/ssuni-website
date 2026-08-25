# Stripe hosted Checkout, with prices built from Supabase at session creation

Payments had no recorded decision at all, despite Orders and Order Status being core to the domain. We chose Stripe's hosted Checkout — redirecting the shopper to Stripe's own payment page — over embedding Payment Elements in the storefront. Hosted Checkout keeps card data entirely off our origin (the lightest PCI scope available, SAQ A), and brings address collection, wallets, and tax handling as configuration rather than code. Payment Elements would give more control over the visual flow, but rebuilding that surface is not something a solo developer should take on against a five-week deadline.

Checkout Sessions are built with inline `price_data` read from the Supabase Product rows at request time, rather than mirroring the catalog into Stripe Products and Prices. This keeps Supabase as the single source of truth per ADR 0002 and avoids a sync job that would need to stay correct as the client edits the catalog.

## Consequences

The purchase flow leaves the SSUNI domain for the payment step, so brand continuity depends on Checkout's branding settings rather than our own components. Because prices are inline, Stripe's dashboard reporting groups by session rather than by Product — per-Product sales analysis has to come from our own `order_items` rows. Anything that depends on a stable Stripe Price object (subscriptions, promotion codes scoped to specific products) would require revisiting this.
