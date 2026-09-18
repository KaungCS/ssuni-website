"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";

/**
 * The two client-side halves of /checkout/success (#19). The page itself stays
 * a server component so the Order is read through RLS rather than trusted from
 * a query string.
 */

/**
 * Empty the Cart, now that the Order it became is confirmed.
 *
 * Rendered only in the confirmed branch, deliberately. Clearing on arrival
 * instead would mean anyone could empty a stranger's Cart by sending them a
 * /checkout/success link -- the page has no way to tell a real return from
 * Stripe from a pasted URL, and the Order not being visible is exactly what
 * says the visitor has no business here. It also means a webhook that never
 * lands leaves the Cart intact, which is the failure anyone would choose.
 */
export function ClearCart() {
  const { clear } = useCart();

  useEffect(() => {
    clear();
  }, [clear]);

  return null;
}

/** Roughly 20 seconds. The webhook normally lands in about one. */
const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 10;

/**
 * The race #19 names: Stripe redirects the shopper back the instant payment
 * succeeds, and the webhook that creates the Order is a separate delivery that
 * may not have arrived. "Order not found" is the wrong answer to that -- the
 * money has left their account.
 *
 * So the page re-renders itself on a timer until the Order appears. Chained
 * setTimeout rather than setInterval: this way a slow refresh cannot stack, and
 * the attempt count that bounds the loop is the same state that drives it.
 *
 * Bounded because an unbounded spinner is a worse lie than an honest "we are
 * still confirming". After that the shopper is pointed at their receipt, which
 * Stripe has already emailed them regardless of anything on our side.
 */
export function AwaitingOrder() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const exhausted = attempts >= POLL_ATTEMPTS;

  useEffect(() => {
    if (exhausted) return;

    const timer = setTimeout(() => {
      setAttempts((n) => n + 1);
      // Re-runs the server component. If the Order has landed, the confirmed
      // branch renders instead and this component unmounts.
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [attempts, exhausted, router]);

  if (exhausted) {
    return (
      <p className="font-belleza text-ssuni-slate">
        Your payment went through and your receipt is on its way by email. The order is
        taking longer than usual to appear here — it will, and nothing further is needed
        from you.
      </p>
    );
  }

  return (
    <p className="font-belleza text-ssuni-slate">
      Payment received. Confirming your order…
    </p>
  );
}
