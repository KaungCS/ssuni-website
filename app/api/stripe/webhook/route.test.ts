import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

/**
 * The webhook route's orchestration. Issues #18 and #30, required by #32.
 *
 * lib/stripe.test.ts covers parseCompletedSession -- "has this been paid?" and
 * "how much?" -- and supabase/tests/admin-path.sql covers complete_checkout's
 * idempotency against the real unique index. Between them sat the route itself:
 * which branch runs, what it calls, and what status code it answers with.
 *
 * The status code is the part worth testing. It is Stripe's retry protocol, not
 * decoration: a 200 where a 500 belongs drops an Order for money that has
 * already been taken, silently and permanently, and nothing else in this repo
 * would catch it.
 *
 * Everything external is mocked because the route holds no logic of its own --
 * the question here is only which of two calls it makes and what it answers.
 */

const SESSION = "cs_test_abc123";
const USER = "33333333-3333-4333-8333-333333333333";

// -- the Supabase double ----------------------------------------------------

const rpc = vi.fn();
const update = vi.fn();
/** Records the .eq() filters, so the `status = 'held'` guard is asserted rather than assumed. */
const eqCalls: [string, string][] = [];

let updateResult: { error: unknown } = { error: null };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc,
    from: () => ({
      update: (values: unknown) => {
        update(values);
        // supabase-js returns a thenable builder: .eq() chains, await resolves.
        const chain = {
          eq(column: string, value: string) {
            eqCalls.push([column, value]);
            return chain;
          },
          then(onFulfilled: (value: { error: unknown }) => unknown) {
            return Promise.resolve(updateResult).then(onFulfilled);
          },
        };
        return chain;
      },
    }),
  }),
}));

// -- the Stripe double ------------------------------------------------------

const constructEventAsync = vi.fn();

vi.mock("@/lib/stripe", async (importOriginal) => ({
  // parseCompletedSession stays real: it is the seam this route trusts.
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({ webhooks: { constructEventAsync } }),
}));

const { POST } = await import("./route");

// -- helpers ----------------------------------------------------------------

function session(overrides: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id: SESSION,
    client_reference_id: USER,
    payment_status: "paid",
    amount_total: 6597,
    ...overrides,
  } as Stripe.Checkout.Session;
}

/** A POST carrying a raw body and a signature header, as Stripe sends one. */
function post(body = "{}", signature: string | null = "t=1,v1=deadbeef") {
  return new Request("https://ssuni.example/api/stripe/webhook", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": signature } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  updateResult = { error: null };
  eqCalls.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("the webhook refuses what it cannot verify", () => {
  it("fails shut, and retryably, when the signing secret is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

    const response = await POST(post());

    // 500 on purpose: the fix is configuration (a Worker secret, see CLAUDE.md),
    // so a later delivery genuinely can succeed where this one could not.
    expect(response.status).toBe(500);
    expect(constructEventAsync).not.toHaveBeenCalled();
  });

  it("rejects a request with no stripe-signature header", async () => {
    const response = await POST(post("{}", null));

    expect(response.status).toBe(400);
    expect(constructEventAsync).not.toHaveBeenCalled();
  });

  it("answers 400, never 500, when the signature does not verify", async () => {
    constructEventAsync.mockRejectedValue(new Error("no signatures found"));

    const response = await POST(post());

    // A forgery and a mismatched secret look identical from here, and neither
    // improves on the tenth delivery. 500 would buy three days of retries.
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("verifies against the raw bytes, not a reparsed body", async () => {
    // Key order and whitespace are inside the signature, so re-stringifying
    // breaks verification for no visible reason. text() must pass through.
    const raw = '{"id":"evt_1",  "type":"payment_intent.succeeded"}';
    constructEventAsync.mockResolvedValue({
      type: "payment_intent.succeeded",
      data: { object: {} },
    });

    await POST(post(raw));

    expect(constructEventAsync).toHaveBeenCalledWith(
      raw,
      "t=1,v1=deadbeef",
      "whsec_test",
      undefined,
      expect.anything(),
    );
  });
});

describe("checkout.session.completed", () => {
  it("records the Order and acknowledges", async () => {
    constructEventAsync.mockResolvedValue({
      type: "checkout.session.completed",
      data: { object: session() },
    });
    rpc.mockResolvedValue({ data: "order-uuid", error: null });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("complete_checkout", {
      p_session_id: SESSION,
      p_user_id: USER,
      // Decimal dollars, not Stripe's cents. An Order recorded at 1/100th of
      // what was charged looks exactly like a working webhook.
      p_total: 65.97,
    });
  });

  it("writes no Order for a Session that has not been paid", async () => {
    constructEventAsync.mockResolvedValue({
      type: "checkout.session.completed",
      data: { object: session({ payment_status: "unpaid" }) },
    });

    const response = await POST(post());

    // Acknowledged, because a retry cannot make unpaid money arrive -- but the
    // RPC must not run, or stock is decremented for a payment that never lands.
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when the database is unreachable", async () => {
    constructEventAsync.mockResolvedValue({
      type: "checkout.session.completed",
      data: { object: session() },
    });
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    const response = await POST(post());

    // The one genuinely retryable case. A 200 here loses the Order for good.
    expect(response.status).toBe(500);
  });

  it("treats a replayed event as done, not as a failure", async () => {
    constructEventAsync.mockResolvedValue({
      type: "checkout.session.completed",
      data: { object: session() },
    });
    // complete_checkout returns NULL when the Session was already recorded.
    rpc.mockResolvedValue({ data: null, error: null });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Already recorded.");
  });
});

describe("checkout.session.expired", () => {
  it("releases only the holds still marked held", async () => {
    constructEventAsync.mockResolvedValue({
      type: "checkout.session.expired",
      data: { object: { id: SESSION } },
    });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ status: "released" });
    // The status filter is the whole safety of this branch: without it a
    // replayed `expired` rewrites a Reservation a payment already consumed,
    // destroying the frozen record of what that Order's lines cost.
    expect(eqCalls).toEqual([
      ["stripe_session_id", SESSION],
      ["status", "held"],
    ]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when the release fails", async () => {
    constructEventAsync.mockResolvedValue({
      type: "checkout.session.expired",
      data: { object: { id: SESSION } },
    });
    updateResult = { error: { message: "connection refused" } };

    const response = await POST(post());

    expect(response.status).toBe(500);
  });
});

describe("everything else", () => {
  it("acknowledges an event type it does not handle, and touches nothing", async () => {
    constructEventAsync.mockResolvedValue({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123" } },
    });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
