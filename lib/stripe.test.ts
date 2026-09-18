import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { parseCompletedSession } from "./stripe";

/**
 * The webhook's read of a `checkout.session.completed` event (#18).
 *
 * TDD is required here by CLAUDE.md: this is a money path, and the two things
 * it decides -- whether the money actually arrived, and how much of it -- are
 * both silent when wrong. An Order recorded at 1/100th of what was charged
 * looks like a working webhook.
 *
 * The idempotency half of #18 is not testable from here at all: it is a unique
 * index and a single transaction, so it is proved against the real database in
 * supabase/tests/admin-path.sql.
 */

const USER = "33333333-3333-4333-8333-333333333333";

/** Only the fields parseCompletedSession reads; the real object has ~60 more. */
function session(overrides: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id: "cs_test_abc123",
    client_reference_id: USER,
    payment_status: "paid",
    amount_total: 6597,
    ...overrides,
  } as Stripe.Checkout.Session;
}

describe("parseCompletedSession", () => {
  it("reads the session id, the shopper, and the total", () => {
    expect(parseCompletedSession(session())).toEqual({
      sessionId: "cs_test_abc123",
      userId: USER,
      total: 65.97,
    });
  });

  it("converts Stripe's cents to the decimal dollars orders.total stores", () => {
    // 100 cents is one dollar, not one hundred. Getting this backwards charges
    // the customer correctly and then records the Order off by 100x, which
    // nothing downstream would notice until the books did not balance.
    expect(parseCompletedSession(session({ amount_total: 100 })!)?.total).toBe(1);
    expect(parseCompletedSession(session({ amount_total: 5 }))?.total).toBe(0.05);
  });

  it("refuses a session that has not actually been paid", () => {
    // checkout.session.completed fires for delayed-notification payment methods
    // before the money lands. Taking it would mark an Order Paid and decrement
    // stock for a payment that can still fail.
    expect(parseCompletedSession(session({ payment_status: "unpaid" }))).toBeNull();
    expect(parseCompletedSession(session({ payment_status: "no_payment_required" }))).toBeNull();
  });

  it("refuses a session with nobody to attribute the Order to", () => {
    // orders.user_id is NOT NULL and ON DELETE RESTRICT. A session without a
    // usable client_reference_id cannot become an Order, and guessing an owner
    // is worse than refusing.
    expect(parseCompletedSession(session({ client_reference_id: null }))).toBeNull();
    expect(parseCompletedSession(session({ client_reference_id: "not-a-uuid" }))).toBeNull();
  });

  it("refuses a session with no total", () => {
    expect(parseCompletedSession(session({ amount_total: null }))).toBeNull();
  });
});
