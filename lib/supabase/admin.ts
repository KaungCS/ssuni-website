import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

/**
 * The Supabase client that bypasses RLS. Handle with care.
 *
 * ADR 0004 makes RLS the only security boundary in this system, and the secret
 * key (`sb_secret_...`) steps around all of it. So the set of callers is the
 * security-relevant fact, and this module exists to make that set greppable --
 * "who bypasses RLS?" is answered by this file's importers, not by three
 * prose comments that nothing enforces.
 *
 * Current callers, and why each one has to be here:
 *
 *   - `app/api/checkout/route.ts` (#15) -- `reserve_cart`. `reservations` has
 *     RLS on with deliberately no policies at all, so no browser key can write
 *     a hold.
 *   - `app/api/stripe/webhook/route.ts` (#18, #30) -- `complete_checkout` and
 *     the release of lapsed holds. `orders` and `order_items` grant INSERT to
 *     nobody (#17), and the request arrives from Stripe with no user session
 *     to run as in any case.
 *
 * `/admin/orders` (#21) is expected to be the third. Adding a caller means
 * adding it to this list -- and asking first whether the request could have
 * gone through RLS instead, which is what `lib/supabase/server.ts` is for.
 *
 * NEVER import this from a client component, and never give the key a
 * `NEXT_PUBLIC_` prefix: that prefix is precisely what ships a value to
 * browsers. Supabase rejects a secret key sent from a browser with a 401, but
 * that is a backstop, not a substitute.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  // Named rather than left to supabase-js, which throws `supabaseKey is
  // required` and says neither which key nor which of Cloudflare's two
  // separate stores it should have come from. That misconfiguration is the one
  // CLAUDE.md devotes a whole table to, and it surfaces at request time on the
  // money path -- the worst possible place to be reading a generic TypeError.
  if (!url || !secretKey) {
    throw new Error(
      `Supabase admin client is not configured: ${!url ? "NEXT_PUBLIC_SUPABASE_URL" : "SUPABASE_SECRET_KEY"} is missing. ` +
        "NEXT_PUBLIC_SUPABASE_URL is a Cloudflare *build* variable; SUPABASE_SECRET_KEY is a Worker secret (Settings -> Variables & Secrets). " +
        "A value in the wrong store is absent here with no build failure.",
    );
  }

  // No session to persist: there is no user, and nothing to refresh.
  return createSupabaseClient<Database>(url, secretKey, {
    auth: { persistSession: false },
  });
}
