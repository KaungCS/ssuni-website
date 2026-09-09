import { describe, expect, it } from "vitest";
import {
  addItem,
  CART_STORAGE_KEY,
  itemCount,
  loadCart,
  MAX_CART_ITEMS,
  parseResolveRequest,
  reconcile,
  removeItem,
  saveCart,
  setQuantity,
} from "./cart";

const HOODIE_ESPRESSO_M = "11111111-1111-4111-8111-111111111111";
const TEE_BONE_S = "22222222-2222-4222-8222-222222222222";

describe("addItem", () => {
  it("sums the quantity when the same Variant is added twice, rather than adding a second Cart Item", () => {
    const once = addItem([], HOODIE_ESPRESSO_M, 1);
    const twice = addItem(once, HOODIE_ESPRESSO_M, 2);

    expect(twice).toEqual([{ variantId: HOODIE_ESPRESSO_M, quantity: 3 }]);
  });
});

describe("setQuantity", () => {
  it("replaces the quantity rather than adding to it", () => {
    const items = addItem([], HOODIE_ESPRESSO_M, 3);

    expect(setQuantity(items, HOODIE_ESPRESSO_M, 1)).toEqual([
      { variantId: HOODIE_ESPRESSO_M, quantity: 1 },
    ]);
  });

  it("removes the Cart Item when the quantity is set to zero, leaving no empty row", () => {
    const items = addItem([], HOODIE_ESPRESSO_M, 3);

    expect(setQuantity(items, HOODIE_ESPRESSO_M, 0)).toEqual([]);
  });
});

describe("removeItem", () => {
  it("removes only the named Variant", () => {
    const items = addItem(addItem([], HOODIE_ESPRESSO_M, 1), TEE_BONE_S, 2);

    expect(removeItem(items, HOODIE_ESPRESSO_M)).toEqual([
      { variantId: TEE_BONE_S, quantity: 2 },
    ]);
  });
});

describe("itemCount", () => {
  it("counts every unit, not every row -- the badge shows pieces, not lines", () => {
    const items = addItem(addItem([], HOODIE_ESPRESSO_M, 2), TEE_BONE_S, 3);

    expect(itemCount(items)).toBe(5);
  });

  it("is zero for an empty Cart", () => {
    expect(itemCount([])).toBe(0);
  });
});

describe("reconcile", () => {
  it("prices each Cart Item and totals them", () => {
    const items = addItem(addItem([], HOODIE_ESPRESSO_M, 2), TEE_BONE_S, 1);
    const availability = {
      [HOODIE_ESPRESSO_M]: { price: 68, availableStock: 5 },
      [TEE_BONE_S]: { price: 34, availableStock: 5 },
    };

    const cart = reconcile(items, availability);

    expect(cart.subtotal).toBe(170);
    expect(cart.items.map((item) => item.status)).toEqual(["ok", "ok"]);
  });

  it("clamps a Cart Item to Available Stock and charges only what can ship", () => {
    const items = addItem([], HOODIE_ESPRESSO_M, 3);
    const availability = { [HOODIE_ESPRESSO_M]: { price: 68, availableStock: 1 } };

    const cart = reconcile(items, availability);

    expect(cart.items[0]).toEqual({
      variantId: HOODIE_ESPRESSO_M,
      quantity: 1,
      requestedQuantity: 3,
      status: "short",
      lineTotal: 68,
    });
    expect(cart.subtotal).toBe(68);
  });

  it("keeps a vanished Variant visible but out of the subtotal, rather than deleting it", () => {
    // A Variant is absent from availability when its Product is Hidden: the
    // variants_available view ends in `where not p.is_hidden`, so hiding a
    // Product in Supabase Studio drops its Variants entirely. Deleting the row
    // is how a shopper checks out believing they bought something they did not.
    const items = addItem(addItem([], HOODIE_ESPRESSO_M, 2), TEE_BONE_S, 1);
    const availability = { [TEE_BONE_S]: { price: 34, availableStock: 5 } };

    const cart = reconcile(items, availability);

    expect(cart.items).toHaveLength(2);
    expect(cart.items[0]).toEqual({
      variantId: HOODIE_ESPRESSO_M,
      quantity: 0,
      requestedQuantity: 2,
      status: "unavailable",
      lineTotal: 0,
    });
    expect(cart.subtotal).toBe(34);
  });

  it("prices an out-of-stock Variant as unavailable, not as a free line", () => {
    const items = addItem([], HOODIE_ESPRESSO_M, 2);
    const availability = { [HOODIE_ESPRESSO_M]: { price: 68, availableStock: 0 } };

    const cart = reconcile(items, availability);

    expect(cart.items[0].status).toBe("unavailable");
    expect(cart.subtotal).toBe(0);
  });

  it("totals decimal prices exactly, without floating-point drift", () => {
    // 19.99 * 3 is 59.97000000000001 in IEEE 754. A subtotal is money the
    // shopper reads and Stripe later charges; it may not carry that tail.
    const items = addItem([], HOODIE_ESPRESSO_M, 3);
    const availability = { [HOODIE_ESPRESSO_M]: { price: 19.99, availableStock: 10 } };

    expect(reconcile(items, availability).subtotal).toBe(59.97);
  });
});

describe("parseResolveRequest", () => {
  it("accepts a list of variant ids", () => {
    expect(parseResolveRequest({ variantIds: [HOODIE_ESPRESSO_M, TEE_BONE_S] })).toEqual([
      HOODIE_ESPRESSO_M,
      TEE_BONE_S,
    ]);
  });

  it("accepts an empty Cart", () => {
    expect(parseResolveRequest({ variantIds: [] })).toEqual([]);
  });

  it("rejects a body that is not shaped like a request at all", () => {
    expect(parseResolveRequest(null)).toBeNull();
    expect(parseResolveRequest("11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(parseResolveRequest({ variantIds: "not-an-array" })).toBeNull();
  });

  it("rejects ids that are not non-empty strings", () => {
    expect(parseResolveRequest({ variantIds: [HOODIE_ESPRESSO_M, 42] })).toBeNull();
    expect(parseResolveRequest({ variantIds: [""] })).toBeNull();
  });

  it("caps the number of ids, so a hostile body cannot become an unbounded query", () => {
    const tooMany = Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => `variant-${i}`);

    expect(parseResolveRequest({ variantIds: tooMany })).toBeNull();
  });

  it("drops ids that are not UUIDs, rather than letting Postgres reject the query", () => {
    // Variant ids are uuid columns. Passing a malformed one makes PostgREST
    // fail the whole request ("invalid input syntax for type uuid"), which
    // turns one corrupted localStorage entry into a 500 and a Cart page stuck
    // on its error state. Dropped ids simply resolve to nothing, which
    // reconcile already reports as unavailable.
    expect(parseResolveRequest({ variantIds: [HOODIE_ESPRESSO_M, "not-a-real-id"] })).toEqual([
      HOODIE_ESPRESSO_M,
    ]);
    expect(parseResolveRequest({ variantIds: ["not-a-real-id"] })).toEqual([]);
  });

  it("collapses duplicates rather than querying the same Variant twice", () => {
    expect(
      parseResolveRequest({ variantIds: [HOODIE_ESPRESSO_M, HOODIE_ESPRESSO_M] }),
    ).toEqual([HOODIE_ESPRESSO_M]);
  });
});

/** An in-memory stand-in for localStorage, so persistence needs no DOM. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    read: () => data,
  };
}

describe("loadCart / saveCart", () => {
  it("round-trips a Cart", () => {
    const storage = fakeStorage();
    const items = addItem(addItem([], HOODIE_ESPRESSO_M, 2), TEE_BONE_S, 1);

    saveCart(storage, items);

    expect(loadCart(storage)).toEqual(items);
  });

  it("is an empty Cart when nothing has been stored", () => {
    expect(loadCart(fakeStorage())).toEqual([]);
  });

  it("is an empty Cart when the stored value is not JSON", () => {
    expect(loadCart(fakeStorage({ [CART_STORAGE_KEY]: "{not json" }))).toEqual([]);
  });

  it("is an empty Cart when the stored JSON is not a list of Cart Items", () => {
    // A stored value from an older or corrupted format must not crash the site
    // on every page load -- the storefront has to render even if the Cart cannot.
    expect(loadCart(fakeStorage({ [CART_STORAGE_KEY]: '{"variantId":"x"}' }))).toEqual([]);
    expect(loadCart(fakeStorage({ [CART_STORAGE_KEY]: '[{"variantId":5}]' }))).toEqual([]);
    expect(loadCart(fakeStorage({ [CART_STORAGE_KEY]: '[{"quantity":1}]' }))).toEqual([]);
  });

  it("does not throw when storage refuses to be read or written", () => {
    // Private-mode browsers and full quotas both throw from localStorage. A
    // shopper with a broken Cart should still get a working storefront.
    const hostile = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(loadCart(hostile)).toEqual([]);
    expect(() => saveCart(hostile, [{ variantId: HOODIE_ESPRESSO_M, quantity: 1 }])).not.toThrow();
  });
});
