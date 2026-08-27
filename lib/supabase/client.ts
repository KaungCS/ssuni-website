import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "../database.types";

/**
 * Browser Supabase client.
 *
 * Uses a publishable key (`sb_publishable_...`), not the legacy `anon` JWT --
 * this project post-dates Supabase's key cutover and never had legacy keys.
 * Its server-side counterpart uses a secret key (`sb_secret_...`), which is
 * rejected with a 401 if it is ever sent from a browser. Never import that one
 * into a client component: ADR 0004 makes RLS the only security boundary, and a
 * secret key bypasses all of it.
 *
 * Note that server.ts -- the companion added in #8 -- also uses the publishable
 * key. Reading the catalog on the server is still an anonymous read, and going
 * through RLS is the point. The secret key appears only where a request has to
 * bypass RLS on purpose: the reservation hold (#15) and the Stripe webhook (#18).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
