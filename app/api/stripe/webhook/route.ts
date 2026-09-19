import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { getStripe, parseCompletedSession } from "@/lib/stripe";

/**
 * Stripe's webhook. Issue #18, per ADR 0010.
 *
 * The path is fixed by scripts/setup-stripe.sh, which is what `stripe listen
 * --forward-to` points at locally and what the dashboard endpoint will point at
 * in #26. Moving it means updating both.
 *
 * Deliberately thin. What can go wrong here is concurrency and retries, and
 * neither is fixable in TypeScript: the four writes behind one paid Session
 * happen inside public.complete_checkout, as one transaction, keyed on a unique
 * index. This file verifies the signature, decides whether the event is one we
 * act on, and makes exactly one call.
 */

/**
 * Status codes are Stripe's retry protocol, not decoration.
 *
 * 2xx means "recorded, stop sending this". Anything else brings the event back,
 * with backoff, for up to three days. So the rule is: return 2xx unless a
 * *later attempt could succeed where this one failed*. A malformed event, an
 * unpaid Session, an event type we do not handle -- none of those improve on
 * retry, and refusing them just buys three days of noise and an eventual
 * "endpoint is failing" email. A database that was unreachable does improve.
 */
export async function POST(request: Request) {
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signingSecret) {
    // Not a 500 by accident: with no secret there is nothing to verify against,
    // and verifying is the only thing standing between this route and anyone
    // who can POST JSON. Failing shut, and retryable because the fix is
    // configuration -- see CLAUDE.md on Worker secrets vs build variables.
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Webhook is not configured.", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing stripe-signature.", { status: 400 });

  // The raw body, before any parsing. The signature covers these exact bytes,
  // so `await request.json()` here -- and re-stringifying -- fails verification
  // on nothing more than key order or whitespace.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    // constructEventAsync with the SubtleCrypto provider, not constructEvent.
    // The synchronous version reaches for Node's crypto module, which workerd
    // does not have -- the same trap as the HTTP client in lib/stripe.ts. It
    // would pass `npm run dev` and fail only on the runtime this site deploys
    // to, so this is a cf:preview-class bug waiting to happen.
    event = await getStripe().webhooks.constructEventAsync(
      payload,
      signature,
      signingSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (cause) {
    // Either a forgery or a mismatched signing secret, and from here they look
    // identical. 400 rather than 500: an unverifiable payload will not verify
    // on the tenth delivery either.
    console.error("[stripe-webhook] signature verification failed:", cause);
    return new Response("Invalid signature.", { status: 400 });
  }

  // Two event types matter: the Session was paid (#18) or it lapsed unpaid
  // (#30). Everything else is noise from a dashboard endpoint subscribing to
  // more than it needs -- acknowledged, not retried.
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.expired"
  ) {
    return new Response(`Ignored ${event.type}.`, { status: 200 });
  }

  // The secret key, which bypasses RLS -- the only place besides the hold in
  // #15 where that is true, and both branches below need it. orders and
  // order_items grant INSERT to nobody (#17) and reservations has RLS on with
  // deliberately no policies, so there is no browser-key path to either write.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );

  // -------------------------------------------------------------------------
  // The Session lapsed unpaid (#30)
  // -------------------------------------------------------------------------
  //
  // This does NOT free the stock. The stock is already free: variants_available
  // counts only Reservations whose expires_at is still in the future, so a hold
  // stops holding anything the moment it lapses, webhook or no webhook (ADR
  // 0010, and supabase/tests/rls.mjs section 6 proves it). What this does is
  // make the table say so, for the client reading it in Supabase Studio.
  //
  // One UPDATE, so no RPC: reserve_cart and complete_checkout are functions
  // because each is several writes that must not be interrupted halfway, and
  // supabase-js cannot open a transaction. A single statement is already atomic.
  if (event.type === "checkout.session.expired") {
    const { error: releaseError } = await admin
      .from("reservations")
      .update({ status: "released" })
      // status: "held" is the whole safety of this. Without it a replayed event
      // would rewrite a Reservation that a payment already consumed -- the
      // frozen record of what an Order's lines cost (#17). Stripe does not send
      // `expired` for a Session that completed, so this should be unreachable;
      // it is also what makes the redelivery Stripe *does* send a clean no-op.
      .eq("stripe_session_id", event.data.object.id)
      .eq("status", "held");

    if (releaseError) {
      // Retryable, by the same rule as the Order write below: the database
      // being unreachable is the one failure a later delivery can improve on,
      // and this update is idempotent. Bookkeeping, but bookkeeping that is
      // cheap to get right and silent when it is wrong.
      console.error("[stripe-webhook] releasing holds failed:", releaseError);
      return new Response("Could not release the holds.", { status: 500 });
    }

    return new Response(`Released holds for ${event.data.object.id}.`, { status: 200 });
  }

  const completed = parseCompletedSession(event.data.object);
  if (!completed) {
    // Logged with the session, because this should be unreachable: #15 sets
    // client_reference_id on every Session it creates and this shop takes only
    // card payments. If it ever fires, the Order is missing and somebody has
    // paid -- so it wants finding in the logs, not a silent 200 and nothing.
    console.error(
      "[stripe-webhook] refused a completed Session:",
      event.data.object.id,
      { payment_status: event.data.object.payment_status },
    );
    return new Response("Session not actionable.", { status: 200 });
  }

  const { data: orderId, error } = await admin.rpc("complete_checkout", {
    p_session_id: completed.sessionId,
    p_user_id: completed.userId,
    p_total: completed.total,
  });

  if (error) {
    // The one genuinely retryable case. Stripe will bring it back, and
    // complete_checkout is idempotent, so a redelivery after the database
    // recovers finishes the job.
    console.error("[stripe-webhook] complete_checkout failed:", error);
    return new Response("Could not record the Order.", { status: 500 });
  }

  // null means the Order already existed -- a retry of something that worked.
  return new Response(orderId ? `Recorded Order ${orderId}.` : "Already recorded.", {
    status: 200,
  });
}
