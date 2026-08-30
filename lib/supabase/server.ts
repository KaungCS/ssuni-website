import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "../database.types";

/**
 * Server Supabase client, for Server Components, Route Handlers and Server
 * Actions. Issue #8.
 *
 * Uses the publishable key, so every query runs as `anon` or as the logged-in
 * user and RLS still decides what comes back (ADR 0004). The secret key must
 * never be read here -- it bypasses RLS entirely and belongs only in the two
 * places that need that on purpose (#15's reservation hold, #18's webhook).
 *
 * Call this per request. Never hoist the result to module scope: on a server
 * that handles many requests at once, a shared client would hand one visitor's
 * session to another.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies -- Next.js has already
            // begun streaming the response by the time a query runs. This throw
            // is expected and safe to swallow *because* middleware.ts refreshes
            // the session on every request and writes the rotated cookie there.
            // If middleware is ever removed, this catch starts silently
            // discarding refreshed tokens and sessions will expire mid-visit.
          }
        },
      },
    }
  );
}
