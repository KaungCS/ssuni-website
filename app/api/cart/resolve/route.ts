import { NextResponse } from "next/server";
import { parseResolveRequest } from "@/lib/cart";
import { getVariantsByIds } from "@/lib/catalog";

/**
 * Resolve a Cart's variant ids to live prices and Available Stock.
 *
 * The Cart lives in localStorage, so `/cart` is a client component -- and a
 * client component cannot import lib/catalog.ts, which reaches next/headers.
 * This route is the seam between the two (ADR 0001, amended 2026-09-08).
 *
 * POST rather than GET, deliberately. The response carries live prices and
 * stock; a GET is cacheable, and a cached one would let the Cart display a
 * price that no longer matches what Stripe charges at checkout (ADR 0008) --
 * the exact failure that storing prices in the Cart was rejected for. POST also
 * has no URL length ceiling, so a large Cart cannot be silently truncated.
 *
 * It returns facts and never verdicts: what is short, what is unavailable, and
 * what the subtotal comes to is decided by `reconcile` in lib/cart.ts, so the
 * money math stays in one tested place. This handler holds no logic of its own
 * -- even the request validation is `parseResolveRequest`, so it is covered by
 * the pure test seam rather than by nothing.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const variantIds = parseResolveRequest(body);
  if (variantIds === null) {
    return NextResponse.json({ error: "Expected { variantIds: string[] }." }, { status: 400 });
  }

  const variants = await getVariantsByIds(variantIds);

  // Never cached, at any layer: prices and Available Stock are live.
  return NextResponse.json(
    { variants },
    { headers: { "Cache-Control": "no-store" } },
  );
}
