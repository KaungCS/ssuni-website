import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client.
 *
 * Uses a publishable key (`sb_publishable_...`), not the legacy `anon` JWT --
 * this project post-dates Supabase's key cutover and never had legacy keys.
 * Its server-side counterpart uses a secret key (`sb_secret_...`), which is
 * rejected with a 401 if it is ever sent from a browser. Never import that one
 * into a client component: ADR 0004 makes RLS the only security boundary, and a
 * secret key bypasses all of it.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}