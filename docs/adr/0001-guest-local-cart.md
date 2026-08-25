# Guest-local cart, login only at checkout

Supabase auth (OTP) already exists in the app, so tying the Cart to a logged-in account was the obvious default. We chose instead to keep the Cart entirely client-side (not persisted to any account) and only require login when the shopper proceeds to checkout. This ships a working add-to-cart experience immediately, without first building server-side cart persistence and account-linking logic, keeping browsing frictionless for anonymous shoppers under a hard end-of-September launch deadline.

## Consequences

Migrating to an account-bound cart later requires merge logic for local cart → account cart at login.
