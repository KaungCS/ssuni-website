# Supabase RLS is the sole read/write boundary

`lib/supabase.ts` only creates a browser client — there is no backend API layer mediating requests between the customer's browser and the database. As Products, Variants, Orders, and Profiles move into Supabase (ADR 0002), Row Level Security policies become the only thing preventing a customer from reading another customer's Orders, or writing to Products/Orders directly from their browser. We're treating "every table has RLS enabled with correct policies" as a hard gate on the Supabase migration, not a follow-up hardening task — the alternative (a mediating backend API layer validating every write) was rejected as more than a one-person team can build and maintain against the September deadline.

## Consequences

No table may go live with default-open or missing RLS policies, even temporarily during development. Policies must at minimum: restrict a customer's read access to their own Profile and Orders; restrict all writes to Products, Variants, Hero Stories, and Order status to the admin-allowlisted user.
