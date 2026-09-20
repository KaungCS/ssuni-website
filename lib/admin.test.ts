import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Admin Dashboard gate, and the tracking-link parser behind it. Issue #21.
 *
 * #32 scopes required TDD to the logic that can lose money, and a dashboard
 * gate is not that -- ADR 0004 is explicit that RLS, not this function, is the
 * security boundary. These tests exist for a narrower reason: the gate has
 * *two* refusals that mean different things, and the difference is invisible
 * until someone is locked out of their own shop. A signed-out admin must be
 * sent to log in; a signed-in stranger must get a 404 and learn nothing.
 *
 * `parseTrackingLink` is here because it is a trust boundary: whatever it
 * returns is rendered straight into an `href` on the *customer's* Order page
 * (app/profile/orders/[id]/page.tsx:77).
 *
 * Same harness as the route suites -- everything external is mocked, because
 * the question is which call the gate makes and what it does with the answer.
 */

const redirect = vi.fn((url: string) => {
  // next/navigation's redirect throws to unwind the render. Mirroring that is
  // what makes "redirect, and do not then fall through to the admin check" a
  // property this file can actually assert.
  throw new Error(`REDIRECT:${url}`);
});
const notFound = vi.fn(() => {
  throw new Error("NOT_FOUND");
});

vi.mock("next/navigation", () => ({ redirect, notFound }));

const getUser = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

const { requireAdmin } = await import("./admin");
const { parseTrackingLink, isOrderStatus } = await import("./orders");

const ADMIN = { id: "admin-uuid", email: "shop@example.test" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdmin", () => {
  it("sends a signed-out visitor to log in, and comes back to /admin", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/login?next=%2Fadmin");

    // The admin check must not run for a visitor with no session at all.
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("404s a signed-in user who is not on the allowlist", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "shopper-uuid" } } });
    maybeSingle.mockResolvedValue({ data: null });

    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");

    // Not a redirect: a stranger must not learn that /admin is a real page.
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns the user when they are on the allowlist", async () => {
    getUser.mockResolvedValue({ data: { user: ADMIN } });
    maybeSingle.mockResolvedValue({ data: { user_id: ADMIN.id } });

    await expect(requireAdmin()).resolves.toEqual(ADMIN);
    expect(notFound).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("parseTrackingLink", () => {
  it("accepts an ordinary carrier URL", () => {
    expect(parseTrackingLink("https://track.example.test/ABC123")).toEqual({
      ok: true,
      value: "https://track.example.test/ABC123",
    });
  });

  it("treats blank input as clearing the link, not as an error", () => {
    expect(parseTrackingLink("")).toEqual({ ok: true, value: null });
    expect(parseTrackingLink("   ")).toEqual({ ok: true, value: null });
  });

  it("refuses a javascript: URL", () => {
    // The whole reason this function exists: the result lands in an href on a
    // page the customer opens.
    expect(parseTrackingLink("javascript:alert(1)").ok).toBe(false);
  });

  it("refuses a data: URL", () => {
    expect(parseTrackingLink("data:text/html,<script>alert(1)</script>").ok).toBe(false);
  });

  it("refuses something that is not a URL at all", () => {
    expect(parseTrackingLink("1Z999AA10123456784").ok).toBe(false);
  });
});

describe("isOrderStatus", () => {
  it("accepts every status the enum declares", () => {
    // Matches public.order_status in 20260918120000_orders.sql exactly. If the
    // two ever drift, the admin's dropdown offers a value Postgres rejects.
    for (const s of ["Paid", "Shipped", "Delivered", "Cancelled", "Refunded"]) {
      expect(isOrderStatus(s)).toBe(true);
    }
  });

  it("rejects anything else, including a case variant", () => {
    expect(isOrderStatus("shipped")).toBe(false);
    expect(isOrderStatus("Returned")).toBe(false);
    expect(isOrderStatus("")).toBe(false);
  });
});
