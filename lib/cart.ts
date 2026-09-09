/**
 * The Cart's money and quantity math, as pure functions.
 *
 * Pure on purpose (ADR 0001, amended 2026-09-08). This module imports nothing:
 * no React, no Supabase, no fetch. Availability arrives as a plain argument, so
 * every rule about what a shopper is charged is testable without a browser or a
 * database -- which is what issue #32 requires of the logic that can lose money.
 */

/** A Variant plus a quantity (CONTEXT.md). Holds a reference, never a price. */
export type CartItem = {
  variantId: string;
  quantity: number;
};

/**
 * Add a quantity of a Variant, merging into the existing Cart Item if there is
 * one. Adding the same Variant twice deepens one line rather than growing a
 * second, so the Cart never shows a shopper the same hoodie on two rows.
 */
export function addItem(items: CartItem[], variantId: string, quantity: number): CartItem[] {
  const existing = items.find((item) => item.variantId === variantId);
  if (!existing) return [...items, { variantId, quantity }];

  return items.map((item) =>
    item.variantId === variantId ? { ...item, quantity: item.quantity + quantity } : item,
  );
}

/**
 * Set a Cart Item's quantity outright. A quantity of zero or less removes the
 * line: a zero-quantity Cart Item would render as a row the shopper cannot
 * interact with and would contribute nothing to the subtotal.
 */
export function setQuantity(items: CartItem[], variantId: string, quantity: number): CartItem[] {
  if (quantity <= 0) return removeItem(items, variantId);

  return items.map((item) => (item.variantId === variantId ? { ...item, quantity } : item));
}

export function removeItem(items: CartItem[], variantId: string): CartItem[] {
  return items.filter((item) => item.variantId !== variantId);
}

/**
 * Total units in the Cart -- what the nav badge shows. Two of one hoodie and
 * three tees is 5, not 2: a badge counting rows tells a shopper they have
 * fewer pieces than they are about to pay for.
 */
export function itemCount(items: CartItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

/** What the server knows about one Variant right now. Supplied by the caller. */
export type VariantAvailability = {
  /** Decimal dollars, matching CatalogProduct.price. */
  price: number;
  /** Available Stock per CONTEXT.md -- stock minus unexpired Reservations. */
  availableStock: number;
};

export type CartItemStatus = "ok" | "short" | "unavailable";

export type ReconciledItem = {
  variantId: string;
  /** What can actually be bought -- clamped to Available Stock. */
  quantity: number;
  /** What the shopper asked for. Differs from `quantity` when status is short. */
  requestedQuantity: number;
  status: CartItemStatus;
  lineTotal: number;
};

export type ReconciledCart = {
  items: ReconciledItem[];
  subtotal: number;
};

/**
 * Money is summed in integer cents and converted back once, at the end.
 *
 * Prices are decimal dollars, and decimal dollars do not add up in binary
 * floating point: 19.99 * 3 is 59.97000000000001. That tail reaches the
 * shopper's screen and, at the Stripe boundary in #15, the amount charged.
 */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Price a Cart against live availability.
 *
 * The subtotal is computed here and nowhere else (ADR 0001, amended
 * 2026-09-08). A second implementation in a component is how `/cart` and
 * checkout come to disagree about what something costs.
 */
export function reconcile(
  items: CartItem[],
  availability: Record<string, VariantAvailability>,
): ReconciledCart {
  let subtotalCents = 0;

  const reconciled = items.map((item) => {
    const variant = availability[item.variantId];

    // Absent from availability means the Variant is not sellable at all -- most
    // often because its Product was Hidden, since variants_available ends in
    // `where not p.is_hidden`. The row survives as unavailable; deleting it is
    // how a shopper checks out believing they bought something they did not.
    // Nothing sellable is treated the same way, so zero stock is unavailable
    // rather than a $0 line that reads as a discount.
    //
    // Clamping rather than refusing: one of the three the shopper wanted is
    // still a sale, and the shortfall is shown rather than silently corrected.
    // `requestedQuantity` survives so the UI can say what changed.
    const quantity = variant ? Math.min(item.quantity, variant.availableStock) : 0;
    const status: CartItemStatus =
      quantity === 0 ? "unavailable" : quantity < item.quantity ? "short" : "ok";
    const lineCents = variant ? toCents(variant.price) * quantity : 0;
    subtotalCents += lineCents;

    return {
      variantId: item.variantId,
      quantity,
      requestedQuantity: item.quantity,
      status,
      lineTotal: lineCents / 100,
    };
  });

  return { items: reconciled, subtotal: subtotalCents / 100 };
}

/**
 * The most Cart Items one resolve request may carry.
 *
 * The body arrives from the internet, and every id becomes a term in a Supabase
 * `.in()` filter. A cap keeps a hostile or buggy client from turning one POST
 * into an unbounded query. Well above any real Cart; raise it if a real shopper
 * ever hits it.
 */
export const MAX_CART_ITEMS = 50;

/**
 * Validate a POST /api/cart/resolve body, returning the variant ids to look up
 * or null if the body is not a request we are willing to serve.
 *
 * Lives here rather than in the route handler so it is covered by the pure test
 * seam: the handler stays a thin call into lib/catalog.ts, which is what makes
 * "the handler returns facts, never verdicts" true rather than aspirational.
 */
export function parseResolveRequest(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;

  const { variantIds } = body as { variantIds?: unknown };
  if (!Array.isArray(variantIds)) return null;
  if (variantIds.length > MAX_CART_ITEMS) return null;
  if (variantIds.some((id) => typeof id !== "string" || id.length === 0)) return null;

  // Duplicates are the client's problem to avoid, not a reason to reject a
  // Cart -- but they must not reach the query as repeated terms.
  return Array.from(new Set(variantIds as string[]));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * The slice of localStorage this module needs, injected rather than reached for.
 *
 * Keeping it an argument is what lets persistence -- including the failure modes
 * that actually happen -- be tested without a DOM.
 */
export type CartStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Versioned on purpose. A Cart Item's shape is a stored format; if it ever
 * changes, bump the key rather than trying to migrate a value that lives in
 * strangers' browsers.
 */
export const CART_STORAGE_KEY = "ssuni.cart.v1";

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;
  const { variantId, quantity } = value as { variantId?: unknown; quantity?: unknown };
  return typeof variantId === "string" && typeof quantity === "number";
}

/**
 * Read the stored Cart, treating anything unexpected as an empty one.
 *
 * Every failure here is silent by design. This runs on the first render of
 * every page; a shopper whose stored Cart is corrupt, or whose browser refuses
 * localStorage outright, should still get a working storefront rather than a
 * blank screen.
 */
export function loadCart(storage: CartStorage): CartItem[] {
  let raw: string | null;
  try {
    raw = storage.getItem(CART_STORAGE_KEY);
  } catch {
    return [];
  }

  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isCartItem)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Persist the Cart, tolerating a storage that refuses to be written. */
export function saveCart(storage: CartStorage, items: CartItem[]): void {
  try {
    storage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private mode, or a full quota. Losing persistence is survivable; throwing
    // out of a render or an effect is not.
  }
}
