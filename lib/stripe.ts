import Stripe from "stripe";

/**
 * The Stripe client, built for the runtime this site actually deploys to.
 *
 * `createFetchHttpClient` is not optional here. The SDK's default HTTP client
 * reaches for Node's `http` module, which does not exist on Cloudflare's
 * workerd -- so the default builds fine, passes `npm run dev`, and fails only
 * under `npm run cf:preview`. See CLAUDE.md on why cf:preview is the gate.
 *
 * Server-only: SUPABASE_SECRET_KEY and STRIPE_SECRET_KEY must never reach a
 * client component.
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");

  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * How long a Checkout Session -- and therefore the Reservation behind it --
 * stays alive. Stripe's documented minimum.
 *
 * Stripe defaults to 24 hours. Because the Reservation inherits this, the
 * default would put a day-long hold on the last unit every time someone opened
 * checkout and wandered off.
 */
export const CHECKOUT_TTL_SECONDS = 30 * 60;

// ---------------------------------------------------------------------------
// Webhook (#18)
// ---------------------------------------------------------------------------

/** Variant ids and client_reference_id are `uuid` columns. Mirrors lib/cart.ts. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the webhook needs from a completed Session to write one Order. */
export type CompletedCheckout = {
  sessionId: string;
  userId: string;
  /** Decimal dollars, matching orders.total. Stripe reports cents. */
  total: number;
};

/**
 * Read a `checkout.session.completed` Session, or refuse it.
 *
 * Separated from the route so the two decisions that can silently cost money --
 * "has this actually been paid?" and "how much?" -- are covered by the pure
 * test seam (#32), the same way parseCheckoutRequest is. The route is left with
 * signature verification and one RPC call.
 *
 * Null means "do not turn this into an Order". Every null is a case where
 * proceeding writes something false: an Order marked Paid for money that has
 * not arrived, or one attributed to a user id that is not one. The caller
 * acknowledges the event anyway -- a retry cannot fix any of these.
 */
export function parseCompletedSession(
  session: Stripe.Checkout.Session,
): CompletedCheckout | null {
  // `completed` fires before the money lands for delayed-notification payment
  // methods (the confirmation is checkout.session.async_payment_succeeded).
  // SSUNI takes cards only, so this should never be anything but "paid" -- but
  // taking it on trust is how stock gets decremented for a payment that then
  // fails. `no_payment_required` is a zero-value Session, which this shop has
  // no way to create and should not be inventing Orders from either.
  if (session.payment_status !== "paid") return null;

  // Set from the verified user at Session creation (#15/#16), so it is the
  // shop's own id for the shopper rather than anything the browser supplied.
  const userId = session.client_reference_id;
  if (!userId || !UUID.test(userId)) return null;

  if (typeof session.amount_total !== "number") return null;

  // Stripe's authoritative number, not a re-sum of the lines: once shipping or
  // tax exists they will differ, and the one that matters is what was charged.
  return { sessionId: session.id, userId, total: session.amount_total / 100 };
}
