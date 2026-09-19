# SSUNI bills in USD, and the storefront is single-currency

Every price in the catalog is stored as a bare `numeric(10, 2)` with no currency attached, and the storefront renders it as `$X.XX` — a symbol that is equally USD, CAD, AUD or SGD. We are recording what was already true in code: **SSUNI charges in US dollars only**. The shop is a Seattle business taking payouts through a US Stripe entity (#6), and its customers are local. Multi-currency was considered and rejected — Stripe supports presentment currencies, but using them means a currency column on `products`, a currency on `reservations.unit_price` and `order_items.unit_price`, and a decision about who bears the conversion spread. That is real work in service of customers SSUNI does not have yet.

The decision lives in exactly one line, `CHECKOUT_CURRENCY` in `lib/cart.ts`, which is what `app/api/checkout/route.ts` puts on every Stripe `price_data`. Nothing else in the codebase names a currency.

## Consequences

Prices, `reservations.unit_price` and `order_items.unit_price` are all implicitly USD, and **an Order recorded before a currency change would be indistinguishable from one recorded after it**. So going multi-currency is not a matter of changing that constant: it means adding a currency column to the tables that store money and backfilling every existing row with `usd` first. Doing it in that order is the whole cost, and doing it in the other order is a silent corruption of order history.

The `$` the storefront renders is deliberately not qualified as `US$`. If SSUNI ever sells outside the US, that label is the cheapest of the changes above — and the one most likely to be forgotten, because nothing breaks when it is wrong.
