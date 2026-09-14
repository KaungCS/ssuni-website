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
