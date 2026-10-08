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
 * One line's total: a unit price times a quantity, through the same integer
 * cents as the subtotal above.
 *
 * Here rather than inline in JSX because an Order's receipt and its entry in
 * the Order history are two files, and `unitPrice * quantity` written out twice
 * is two places for the rule to drift -- the same reason the subtotal is
 * computed once. /checkout/success and /profile/orders/[id] both call this.
 */
export function lineTotal(unitPrice: number, quantity: number): number {
  return (toCents(unitPrice) * quantity) / 100;
}

/**
 * Decimal dollars as the storefront prints them. The one money formatter.
 *
 * Lives in this module because it is the only money module both halves of the
 * app can reach: lib/orders.ts touches `next/headers` and so cannot be imported
 * by the client `/cart`, which is how two identical copies of this came to
 * exist. lib/orders.ts re-exports it, so Order pages still have one door.
 */
export function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
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
    // often because its Product was Hidden, whose Variants RLS withholds from
    // shoppers (variants_select_visible defers to products_select_visible). The row survives as unavailable; deleting it is
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
 * Variant ids are `uuid` columns. A malformed one makes PostgREST reject the
 * whole request -- "invalid input syntax for type uuid" -- so one corrupted
 * localStorage entry would turn the Cart into a 500.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Malformed ids are dropped rather than rejected: they resolve to nothing,
  // and `reconcile` already reports an absent Variant as unavailable, so a
  // corrupted Cart degrades to "this piece is no longer available" instead of
  // failing the request for every other line in it. The cap above is checked
  // first, so a flood of junk ids is still refused outright.
  //
  // Duplicates are the client's problem to avoid, not a reason to reject a
  // Cart -- but they must not reach the query as repeated terms.
  return Array.from(new Set((variantIds as string[]).filter((id) => UUID.test(id))));
}

/**
 * Validate a POST /api/checkout body, returning the Cart Items to charge for or
 * null if this is not a request we are willing to serve.
 *
 * Deliberately stricter than parseResolveRequest above, which drops malformed
 * ids and tolerates duplicates. That one feeds a display: degrading to "this
 * piece is no longer available" is kinder than failing the whole Cart. This one
 * feeds a charge, where quietly buying a subset of what was asked for is worse
 * than refusing.
 *
 * A repeated variantId is rejected rather than merged. The Cart merges on add
 * (see addItem), so a duplicate means a broken client -- and if it reached the
 * hold, `on conflict do nothing` would reserve one line's worth of stock while
 * the Session charged for two.
 */
export function parseCheckoutRequest(body: unknown): CartItem[] | null {
  if (typeof body !== "object" || body === null) return null;

  const { items } = body as { items?: unknown };
  if (!Array.isArray(items)) return null;
  if (items.length === 0 || items.length > MAX_CART_ITEMS) return null;

  const parsed: CartItem[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) return null;
    const { variantId, quantity } = raw as { variantId?: unknown; quantity?: unknown };

    if (typeof variantId !== "string" || !UUID.test(variantId)) return null;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) return null;
    if (seen.has(variantId)) return null;

    seen.add(variantId);
    parsed.push({ variantId, quantity });
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Checkout line items (#15)
// ---------------------------------------------------------------------------

/**
 * Confirmed with Kaung on 2026-09-13, matching the $X.XX the storefront renders,
 * and recorded in ADR 0014 on 2026-09-18.
 *
 * The only line in the codebase that names a currency -- but read the ADR before
 * changing it. Prices, `reservations.unit_price` and `order_items.unit_price`
 * are all implicitly USD, so flipping this alone would leave Orders taken before
 * and after the change indistinguishable from each other.
 */
export const CHECKOUT_CURRENCY = "usd";

/** Everything checkout needs to describe one line to Stripe. */
export type CheckoutVariant = VariantAvailability & {
  productName: string;
  color: string;
  size: string;
  imageUrl: string | null;
};

/** One Stripe `price_data` line. Structural, so this module still imports nothing. */
export type CheckoutLineItem = {
  price_data: {
    currency: string;
    unit_amount: number;
    product_data: { name: string; images?: string[] };
  };
  quantity: number;
};

/**
 * Build Stripe line items from live catalog data (ADR 0008: inline price_data,
 * never a mirrored Stripe catalog).
 *
 * `unit_amount` goes through the same toCents as the subtotal, on purpose. A
 * second rounding here is how the Cart and the amount charged come to differ by
 * a cent, and a cent is enough for a customer to notice and not trust you.
 *
 * A Variant absent from the map is skipped rather than priced at zero -- the
 * route has already refused such a Cart with a 409, and a zero-price line would
 * read as a free gift if that check were ever weakened.
 *
 * An image that is not an absolute http(s) URL is dropped rather than sent.
 * Stripe rejects a relative one with `url_invalid` and fails the entire
 * Session, so passing the seeded "/images/download.jpeg" straight through makes
 * a missing photograph block the sale of a Product that is otherwise perfectly
 * sellable. The picture is decoration; the charge is not. Callers that can
 * resolve a relative path -- the route knows the request origin -- should hand
 * this an absolute URL so the photograph survives.
 */
export function toStripeLineItems(
  items: CartItem[],
  variants: Record<string, CheckoutVariant>,
): CheckoutLineItem[] {
  // Parsed rather than pattern-matched, so a "url" like `javascript:` is
  // rejected by scheme instead of by a regex someone has to keep correct.
  const isAbsoluteHttpUrl = (url: string): boolean => {
    try {
      const { protocol } = new URL(url);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  };

  const lines: CheckoutLineItem[] = [];

  for (const item of items) {
    const variant = variants[item.variantId];
    if (!variant) continue;

    lines.push({
      price_data: {
        currency: CHECKOUT_CURRENCY,
        unit_amount: toCents(variant.price),
        product_data: {
          name: `${variant.productName} — ${variant.color} / ${variant.size}`,
          ...(variant.imageUrl && isAbsoluteHttpUrl(variant.imageUrl)
            ? { images: [variant.imageUrl] }
            : {}),
        },
      },
      quantity: item.quantity,
    });
  }

  return lines;
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
