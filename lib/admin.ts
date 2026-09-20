import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/**
 * The Admin Dashboard's gate. Issue #21, per ADR 0007 (amended 2026-09-19).
 *
 * **This is UX, not security.** ADR 0004 makes RLS the sole read/write boundary,
 * and every table the dashboard touches already carries an admin-only write
 * policy (`products_admin_write`, `variants_admin_write`,
 * `hero_stories_admin_write`, `orders_admin_all`). A visitor who defeated this
 * function would be served nothing by any of them. What it decides is whether to
 * *render* a page, so that a non-admin gets a 404 rather than an empty dashboard
 * that implies there is something to see.
 *
 * Like lib/catalog.ts and lib/orders.ts this reaches next/headers, so no client
 * component may import a runtime value from it.
 */

/**
 * The signed-in admin, or no return at all.
 *
 * Two different answers on purpose, matching what #16 and #20 already do:
 *
 * - **Signed out → `/login?next=…`.** The admin is one of the people who will
 *   hit this, and 404ing your own dashboard because a cookie expired is a bad
 *   half-hour. `app/login/page.tsx` already guards the `next` round trip
 *   against open redirects, so this reuses it rather than inventing one.
 * - **Signed in, not an admin → `notFound()`.** The same rule as a stranger's
 *   Order id in `/profile/orders/[id]`: the visitor learns nothing about
 *   whether the page is real.
 *
 * The admin check reads `public.admins` under `admins_select_self`, which
 * returns at most the caller's own row (see
 * supabase/migrations/20260919130000_admins_select_self.sql). It cannot be used
 * to enumerate the allowlist, and `private.is_admin()` deliberately is not
 * reachable over REST.
 */
export async function requireAdmin() {
  const supabase = await createClient();

  // getUser() rather than getSession(): this decides what gets rendered, so it
  // is verified with Supabase rather than taken from what the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A layout cannot see the requested pathname, so `next` points at the
  // dashboard root, which forwards to /admin/orders. A signed-out admin
  // deep-linking to a specific admin page lands one click away rather than
  // exactly where they started -- the cost of not threading a pathname through
  // middleware, which CLAUDE.md has good reason to leave alone.
  if (!user) redirect(`/login?next=${encodeURIComponent("/admin")}`);

  const { data } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) notFound();

  return user;
}
