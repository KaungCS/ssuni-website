# Manual QA: the signed-in half

Everything in this file exists because **no automated seam in this repo can produce a Supabase session in a browser**. `supabase/tests/rls.mjs` drives raw HTTP clients and proves what the *database* returns; vitest covers pure logic and route handlers with everything mocked. Neither one renders a page for a logged-in person, so every check below is yours to click.

Not a launch gate on its own — #25 is. This is the checklist #25's sweep leans on, kept in one place so it is not re-derived from three handoffs each time.

## Before you start

```bash
npm run dev          # nothing else running — see CLAUDE.md on .next corruption
```

Two facts that make this whole file workable:

**You only have one email address.** Resend will not deliver OTP mail to a second address until the sending domain exists (#27), so "sign in as a different person" is not available to you by hand. Everywhere below that needs a second identity, the RLS suite covers it instead, and it is called out.

**Admin-ness is a table lookup, not a claim in your token.** `requireAdmin()` reads `public.admins` on every request (`lib/admin.ts`), and `private.is_admin()` does the same inside every policy. So you can become a non-admin and back **without signing out** — delete the row, reload, re-insert the row, reload. No OTP round trip.

### The two SQL snippets

Supabase Studio → SQL Editor. Keep both open in a tab; you will run them several times.

```sql
-- Become an ordinary customer
delete from public.admins
where user_id = (select id from auth.users where email = 'kaunglin445@gmail.com');
```

```sql
-- Become an admin again  ← run this at the end, every time
insert into public.admins (user_id)
select id from auth.users where email = 'kaunglin445@gmail.com'
on conflict do nothing;
```

> **The one way to hurt yourself with this file** is to close the laptop after the first snippet. You are then a customer, `/admin` 404s, and there is no UI anywhere that can grant you admin back — by design (`public.admins` has no write grant from the browser). The fix is the second snippet, but you have to remember it exists. Run it before you stop.

---

## Part A — Auth, and getting out of an account

The sign-out work is unmerged on `feat/admin-ux-and-signout`; check it out first if it has not landed yet.

- [ ] Signed out, visit `/profile` → lands on `/login?next=/profile`
- [ ] Signed out, visit `/admin` → lands on `/login?next=/admin`
- [ ] Sign in with the OTP → you are returned to where `next` pointed, not to `/`
- [ ] `/login` while already signed in shows "Signed in as …" and a Sign out button, not the OTP form
- [ ] Sign out from `/profile` → lands on the OTP form
- [ ] Sign out from `/login` → same
- [ ] Sign out from the dashboard header → same
- [ ] After signing out, the browser back button does not show a working dashboard (reload it — a cached render is fine, a *working* one is not)
- [ ] Your Cart survives signing out. It is `localStorage` and belongs to the browser, not the account — emptying it would be a surprise mid-purchase

**Covered by machine instead:** that customer B cannot read customer A's Orders. `rls.mjs` will drive two real tokens once step 5 lands; you cannot do this half by hand at all.

## Part B — Admin vs customer, on the same account

Run the *"Become an ordinary customer"* snippet, then, **without signing out**, reload:

- [ ] `/admin` → 404 (not a redirect, not an empty dashboard)
- [ ] `/admin/orders`, `/admin/products`, `/admin/products/<some id>` → 404
- [ ] Clicking **Profile** in the nav → your Order history, not the dashboard
- [ ] `/catalog` → no Hidden pills, and a Hidden Product's URL 404s

Run the *"Become an admin again"* snippet and reload:

- [ ] Clicking **Profile** → lands on `/admin`, not `/profile`
- [ ] `/catalog` → Hidden Products appear, faded, with a **Hidden** pill at the bottom-left of the card
- [ ] A Hidden Product's detail page explains that shoppers cannot see it — and **its colour and size pickers are populated** (an admin sees a Hidden Product's Variants; if they are empty, something regressed in `variants_select_visible`)

## Part C — The dashboard does what it claims

- [ ] Create a Product in `/admin/products`, with a Variant and an uploaded image, and see it on `/catalog`
- [ ] Hide it → it vanishes from `/catalog` for a customer (Part B's toggle) and stays in `/admin/products`
- [ ] Lower a Variant's stock below its held Reservations → Available Stock floors at 0 rather than going negative
- [ ] Mark an Order **Shipped** with a Tracking Link → **the link appears on the customer's `/profile`** (same account, so check `/profile` after the "become a customer" toggle)
- [ ] Delete a Product that has an Order against it → refused, with a sentence about a sale's record, not a raw Postgres error

**After step 4 lands:**

- [ ] Create a Hero Story with an uploaded image entirely in `/admin/hero` → it appears on `/`
- [ ] Reorder with the arrows and with the position box → the order on `/` matches, and the numbers stay `0…n-1`
- [ ] Hide a Story → it is gone from `/` **even though you are the admin**, and still listed in `/admin/hero` (this is the 2026-09-22 amendment to ADR 0003; on the catalog side the opposite is true, and that asymmetry is deliberate)
- [ ] Hide *every* Story → `/` falls back to the SSUNI wordmark, not a blank page
- [ ] Delete a Story → the browser asks first

## Part D — The money path, as a signed-in shopper

Sandbox mode, with `stripe listen` running (`scripts/setup-stripe.sh`; the CLI must be authorized for the **Ssuni sandbox**, not just Test mode).

- [ ] Add to Cart → `/cart` totals match the catalog prices
- [ ] Checkout while signed out → sent to `/login?next=…`, and the Cart is intact afterwards
- [ ] Complete a sandbox purchase → `/checkout/success` shows a pending state first if the webhook has not arrived, then the Order
- [ ] The Cart empties only once the Order is visible
- [ ] `/profile` lists the Order; `/profile/orders/<id>` shows it in full
- [ ] Someone else's Order id in that URL → 404 (you cannot test this properly with one account; `rls.mjs` proves it)
- [ ] Abandon a checkout and wait for the Session to expire → the held stock returns to Available Stock

## Part E — Before you close the laptop

- [ ] **Run the "Become an admin again" snippet.** Check `/admin` loads.
- [ ] Delete any probe Products, Variants or Hero Stories you created — the client's catalog is live data (#5)
- [ ] If you toggled `is_hidden` on a *real* Product, put it back

---

## What this file is not

It is not the RLS audit. #24 is proved by `npm run db:verify` and its evidence comment, with real tokens rather than clicks — a human clicking around proves the UI behaves, never that the policy holds. If a check here fails, the question is which of the two is wrong.
