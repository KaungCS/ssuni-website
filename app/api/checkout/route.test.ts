import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESERVATION_GRACE_SECONDS } from "@/lib/stripe";

/**
 * The checkout route's orchestration. Issue #15, per ADR 0008 and ADR 0010,
 * required by #32.
 *
 * lib/cart.test.ts covers the pure seams this route stands on --
 * `parseCheckoutRequest`, `reconcile`, `toStripeLineItems` -- and
 * supabase/tests/rls.mjs section 9 proves `reserve_cart` against a real
 * database. Between them sat the route: the login gate, the preflight, the two
 * error codes after the hold, and the compensation.
 *
 * The compensation is why this file exists. When the hold fails, the only thing
 * standing between a shopper and a live Stripe Session with no stock behind it
 * is one `sessions.expire()` call on a branch nothing exercised. Both routes
 * into it are asserted below.
 *
 * Everything external is mocked. The same harness as
 * app/api/stripe/webhook/route.test.ts, for the same reason: the question is
 * which calls this route makes, in which order, and what it answers with.
 */

const VARIANT = "11111111-1111-4111-8111-111111111111";
const OTHER_VARIANT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const SESSION = "cs_test_abc123";

/** Session creation and the hold in the order they actually happened. */
const calls: string[] = [];

// -- the Supabase doubles ---------------------------------------------------

const rpc = vi.fn();
const getUser = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => {
      calls.push("reserve_cart");
      return rpc(...args);
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

// -- the catalog double -----------------------------------------------------
//
// Mocked wholesale rather than stubbed at the query level: lib/catalog.ts
// reaches next/headers, and what this route needs from it is a list of prices.

const getVariantsByIds = vi.fn();

vi.mock("@/lib/catalog", () => ({ getVariantsByIds }));

// -- the Stripe double ------------------------------------------------------

const create = vi.fn();
const expire = vi.fn();

vi.mock("@/lib/stripe", async (importOriginal) => ({
  // CHECKOUT_TTL_SECONDS stays real: the expiry it produces is asserted below.
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => {
          calls.push("sessions.create");
          return create(...args);
        },
        expire,
      },
    },
  }),
}));

const { POST } = await import("./route");

// -- helpers ----------------------------------------------------------------

function variant(overrides: Record<string, unknown> = {}) {
  return {
    variantId: VARIANT,
    productSlug: "linen-tee",
    productName: "Linen Tee",
    imageUrl: "/images/tee.jpeg",
    color: "Sand",
    size: "M",
    price: 19.99,
    availableStock: 5,
    ...overrides,
  };
}

function post(body: unknown, raw?: string) {
  return new Request("https://ssuni.example/api/checkout", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** One line, three units of a Variant with five in stock. */
const CART = { items: [{ variantId: VARIANT, quantity: 3 }] };

/** Stripe's answer to a successful create. */
const STRIPE_SESSION = {
  id: SESSION,
  url: "https://checkout.stripe.com/c/pay/cs_test_abc123",
  expires_at: 1_800_000_000,
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  calls.length = 0;
  getUser.mockResolvedValue({ data: { user: { id: USER, email: "shopper@example.com" } } });
  getVariantsByIds.mockResolvedValue([variant()]);
  create.mockResolvedValue(STRIPE_SESSION);
  expire.mockResolvedValue({});
  rpc.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("what the route refuses before it costs anything", () => {
  it("rejects a body that is not JSON", async () => {
    const response = await POST(post(null, "not json at all"));

    expect(response.status).toBe(400);
    expect(getVariantsByIds).not.toHaveBeenCalled();
  });

  it("rejects a malformed Cart", async () => {
    // A repeated variantId, which parseCheckoutRequest refuses outright: `on
    // conflict do nothing` would hold one line's stock for two lines' charge.
    const response = await POST(
      post({
        items: [
          { variantId: VARIANT, quantity: 1 },
          { variantId: VARIANT, quantity: 1 },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a signed-out shopper before reading the catalog or calling Stripe", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(post(CART));

    expect(response.status).toBe(401);
    // The gate's placement is the point (#16): no Reservation is ever held for
    // a Session with nobody to attribute the Order to, and a signed-out probe
    // costs neither a Supabase read nor a Stripe call.
    expect(getVariantsByIds).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("answers 409 with the offending lines when the Cart is already hopeless", async () => {
    getVariantsByIds.mockResolvedValue([variant({ availableStock: 1 })]);

    const response = await POST(post(CART));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.lines).toEqual([
      expect.objectContaining({ variantId: VARIANT, status: "short", quantity: 1 }),
    ]);
    // Advisory only -- ADR 0010 leaves the verdict to the RPC -- but it must
    // spend no Stripe call on a Cart that cannot succeed.
    expect(create).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a Variant that vanished from the catalog as unavailable", async () => {
    // variants_available ends in `where not p.is_hidden`, so hiding a Product
    // in Studio drops its Variants out of the resolve entirely.
    getVariantsByIds.mockResolvedValue([]);

    const response = await POST(post(CART));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.lines).toEqual([
      expect.objectContaining({ variantId: VARIANT, status: "unavailable" }),
    ]);
  });
});

describe("the Session and the hold", () => {
  it("creates the Session before holding the stock", async () => {
    await POST(post(CART));

    // Deliberate ordering (#15): the Reservation carries Stripe's real session
    // id, so the unique index on (stripe_session_id, variant_id) -- which is
    // what makes the webhook idempotent -- never guards a placeholder.
    expect(calls).toEqual(["sessions.create", "reserve_cart"]);
  });

  it("holds exactly what Stripe was told to charge for", async () => {
    await POST(post(CART));

    expect(rpc).toHaveBeenCalledWith("reserve_cart", {
      p_session_id: SESSION,
      p_expires_at: expect.any(String),
      // unit_price rides along so the webhook copies it to order_items rather
      // than re-reading products.price, which can move before a retry lands.
      p_items: [{ variant_id: VARIANT, quantity: 3, unit_price: 19.99 }],
    });
  });

  it("holds the stock past the Session it belongs to", async () => {
    await POST(post(CART));

    const heldUntil = Date.parse(rpc.mock.calls[0][1].p_expires_at) / 1000;

    // Deliberately NOT session.expires_at. A shopper who pays in the last
    // seconds of the window is accepted by Stripe, but the hold would lapse at
    // the mark -- and variants_available counts only Reservations with
    // expires_at > now(), so between that instant and the webhook landing the
    // stock is unheld and someone else can buy the same unit. ADR 0010.
    expect(heldUntil).toBeGreaterThan(STRIPE_SESSION.expires_at);
    expect(heldUntil).toBe(STRIPE_SESSION.expires_at + RESERVATION_GRACE_SECONDS);
  });

  it("sends Stripe an absolute image URL and the shopper's identity", async () => {
    await POST(post(CART));

    const [args] = create.mock.calls[0];
    // Products store a site-relative path; Stripe rejects one with url_invalid
    // and fails the whole Session. This route is the only layer that knows the
    // request origin.
    expect(args.line_items[0].price_data.product_data.images).toEqual([
      "https://ssuni.example/images/tee.jpeg",
    ]);
    expect(args.client_reference_id).toBe(USER);
    expect(args.success_url).toContain("https://ssuni.example/checkout/success");
  });

  it("returns the Stripe URL uncacheable", async () => {
    const response = await POST(post(CART));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: STRIPE_SESSION.url });
    // A cached checkout URL is another shopper's Session.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(expire).not.toHaveBeenCalled();
  });
});

describe("compensation when the hold does not happen", () => {
  it("answers 502 and leaves nothing held when Stripe cannot be reached", async () => {
    create.mockRejectedValue(new Error("network"));

    const response = await POST(post(CART));

    expect(response.status).toBe(502);
    expect(rpc).not.toHaveBeenCalled();
    // No Session exists, so there is nothing to expire.
    expect(expire).not.toHaveBeenCalled();
  });

  it("expires the Session when the hold errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    const response = await POST(post(CART));

    expect(response.status).toBe(502);
    // The whole point of this file. Without this call a live Session exists
    // with no stock behind it, and the shopper never even got the URL.
    expect(expire).toHaveBeenCalledWith(SESSION);
  });

  it("expires the Session when a line sold out during checkout", async () => {
    rpc.mockResolvedValue({
      data: [{ variant_id: VARIANT, requested: 3, available: 1 }],
      error: null,
    });

    const response = await POST(post(CART));
    const body = await response.json();

    // 409 not 502: the shopper can fix this one by editing their Cart.
    expect(response.status).toBe(409);
    expect(body.lines).toEqual([{ variant_id: VARIANT, requested: 3, available: 1 }]);
    expect(expire).toHaveBeenCalledWith(SESSION);
  });

  it("still answers when expiring the Session itself fails", async () => {
    // Tidiness, not a race to win -- nobody has the URL. The Session lapses on
    // its own regardless, and checkout.session.expired (#30) releases the hold.
    expire.mockRejectedValue(new Error("stripe down"));
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    const response = await POST(post(CART));

    expect(response.status).toBe(502);
  });

  it("does not expire a Session that succeeded with a multi-line Cart", async () => {
    getVariantsByIds.mockResolvedValue([
      variant(),
      variant({ variantId: OTHER_VARIANT, price: 45.5, availableStock: 2 }),
    ]);

    const response = await POST(
      post({
        items: [
          { variantId: VARIANT, quantity: 3 },
          { variantId: OTHER_VARIANT, quantity: 2 },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(expire).not.toHaveBeenCalled();
  });
});
