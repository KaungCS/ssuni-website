import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  parseCheckoutRequest,
  reconcile,
  toStripeLineItems,
  type CheckoutVariant,
} from "@/lib/cart";
import { getVariantsByIds } from "@/lib/catalog";
import { CHECKOUT_TTL_SECONDS, getStripe } from "@/lib/stripe";
import { createClient as createUserClient } from "@/lib/supabase/server";

/**
 * Turn a Cart into a Stripe-hosted Checkout Session, and hold the stock behind
 * it. Issue #15, per ADR 0008 (hosted Checkout, inline price_data) and ADR 0010
 * (reserve at session creation, atomically).
 *
 * The Session is created before the hold so the Reservation carries Stripe's
 * real session id and expiry -- the unique index on
 * (stripe_session_id, variant_id) is what makes #18 idempotent, and it should
 * never be enforcing uniqueness over a placeholder. If the hold then fails, the
 * Session is expired and the shopper never receives the URL.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const items = parseCheckoutRequest(body);
  if (items === null) {
    return NextResponse.json(
      { error: "Expected { items: [{ variantId, quantity }] }." },
      { status: 400 },
    );
  }

  // The login gate (#16, ADR 0001). Browsing and the Cart stay anonymous; the
  // first thing that requires an account is paying, and this is that moment.
  //
  // getUser() rather than getSession(): it verifies the token with Supabase
  // instead of trusting what the cookie claims. The Cart page's signed-out
  // banner reads the session locally because it is a hint; this is the gate,
  // and the id it produces becomes orders.user_id (#17), so it has to be real.
  //
  // Placed before the Supabase read and the Stripe call so a signed-out shopper
  // costs neither -- and, more importantly, so no Reservation is ever held for
  // a Session that has nobody to attribute the Order to.
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Please sign in to check out." },
      { status: 401 },
    );
  }

  const origin = new URL(request.url).origin;

  // Prices come from the database, never from the browser (ADR 0001/0008).
  const resolved = await getVariantsByIds(items.map((i) => i.variantId));

  const variants: Record<string, CheckoutVariant> = Object.fromEntries(
    resolved.map((v) => [
      v.variantId,
      {
        price: v.price,
        availableStock: v.availableStock,
        productName: v.productName,
        color: v.color,
        size: v.size,
        // Products store a site-relative path ("/images/download.jpeg"), and
        // Stripe only accepts an absolute URL -- it rejects a relative one with
        // `url_invalid` and fails the whole Session. Resolved here because this
        // is the only layer that knows the request origin; lib/cart.ts imports
        // nothing and drops anything still relative by the time it gets there.
        imageUrl: v.imageUrl ? new URL(v.imageUrl, origin).toString() : null,
      },
    ]),
  );

  // Advisory only. ADR 0010 is explicit that the RPC below is the sole
  // authority on whether stock can be sold; this exists so a Cart that is
  // already hopeless does not cost a Stripe API call. It reuses `reconcile` so
  // the route and /cart cannot disagree about which line is the problem.
  const preflight = reconcile(items, variants);
  const blocked = preflight.items.filter((i) => i.status !== "ok");
  if (blocked.length > 0) {
    return NextResponse.json(
      { error: "Some items are no longer available.", lines: blocked },
      { status: 409 },
    );
  }

  const stripe = getStripe();

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: toStripeLineItems(items, variants),
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      // Who this Order belongs to. client_reference_id is Stripe's own field
      // for the merchant's id of the customer, and it comes back on
      // checkout.session.completed -- so #18 fills orders.user_id from the
      // event itself, with no lookup table and nothing to keep in sync.
      client_reference_id: user.id,
      // Prefills Stripe's email field and addresses the receipt. Not identity:
      // client_reference_id above is what the Order is attributed to.
      customer_email: user.email,
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
    });
  } catch (cause) {
    // The shopper gets a generic message; the operator needs the reason. A
    // silent 502 here is indistinguishable from a network blip, and the two
    // want very different responses.
    console.error("[checkout] Stripe session creation failed:", cause);
    return NextResponse.json({ error: "Could not reach Stripe." }, { status: 502 });
  }

  // The hold bypasses RLS, so it uses the secret key -- the only place besides
  // the webhook (#18) where that is true.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: shortfalls, error } = await admin.rpc("reserve_cart", {
    p_session_id: session.id,
    p_expires_at: new Date(session.expires_at * 1000).toISOString(),
    p_items: items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
  });

  if (error || (shortfalls ?? []).length > 0) {
    // Nobody has the URL, so expiring is tidiness rather than a race to win.
    // If it fails, the Session lapses on its own in 30 minutes.
    await stripe.checkout.sessions.expire(session.id).catch(() => {});

    if (error) {
      console.error("[checkout] reserve_cart failed:", error);
      return NextResponse.json({ error: "Could not hold stock." }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Some items sold out while you were checking out.", lines: shortfalls },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { url: session.url },
    { headers: { "Cache-Control": "no-store" } },
  );
}
