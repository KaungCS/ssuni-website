import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./lib/database.types";

/**
 * Session refresh. Issue #8.
 *
 * Supabase access tokens are short-lived. Without something rotating them on
 * every request, a shopper who idles past the expiry is silently signed out --
 * which would land squarely on the checkout login gate (#16). This runs before
 * any page renders, swaps an expiring token for a fresh one, and writes the new
 * cookie onto the outgoing response.
 *
 * DO NOT "fix" the deprecation warning this file produces on build. Next.js 16
 * renamed this convention to `proxy.ts` and warns about the old name on every
 * build -- but a Proxy file is forced onto the Node.js runtime (Next.js refuses
 * route segment config there: "Proxy always runs on Node.js runtime"), and
 * @opennextjs/cloudflare rejects Node middleware outright: "Node.js middleware
 * is not currently supported. Consider switching to Edge Middleware." The
 * rename builds clean under `next build` and then fails `npm run cf:preview`,
 * which is the runtime we actually deploy to (ADR 0005).
 *
 * So: deprecated filename, working deployment. Revisit only when
 * @opennextjs/cloudflare adds Node middleware support.
 *
 * Three things here are load-bearing and look optional:
 *
 * 1. `request.cookies` AND `response.cookies` are both updated in setAll. The
 *    first is what this request's Server Components will read; the second is
 *    what reaches the browser. Updating only one is the failure mode the
 *    @supabase/ssr docs call "significant and difficult to debug".
 *
 * 2. The `headers` argument (@supabase/ssr >= 0.12) carries no-store cache
 *    directives. A response that sets an auth cookie must never be cached, or a
 *    CDN can serve one visitor's session to the next. Most published examples
 *    predate this argument and drop it.
 *
 *    Measured, not assumed: `Pragma` and `Expires` arrive intact, but Next.js
 *    sets its own `Cache-Control` on dynamic routes afterwards and wins, so the
 *    response ends up `no-cache, must-revalidate` rather than the library's
 *    `private, ..., no-store`. Acceptable here -- the storefront is
 *    force-dynamic and Cloudflare does not cache responses carrying Set-Cookie
 *    -- but if a route is ever made cacheable, re-check this before shipping it.
 *
 * 3. `getClaims()` is what actually triggers the refresh. The client is lazy --
 *    remove this call and the middleware becomes an expensive no-op.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    }
  );

  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    /*
     * Every path except static assets and image files. Those are served without
     * a session and refreshing one for each of them would multiply the auth
     * round trips per page view.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
