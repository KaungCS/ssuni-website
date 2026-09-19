import { createClient } from "./supabase/server";

/**
 * The only place anything reads or writes Orders. Issues #20 and #21.
 *
 * Extracted from app/checkout/success/page.tsx, which had this query inline
 * with a note saying /profile would be the second caller and the point where
 * pulling it out paid. Three callers now share one select string, which is the
 * thing that matters: an Order rendered from two different embeds is how a
 * receipt and an order history come to disagree about what was bought.
 *
 * This module reaches next/headers through lib/supabase/server.ts, exactly like
 * lib/catalog.ts, so **no client component may import a runtime value from it**
 * -- the build fails with "You're importing a module that depends on
 * next/headers". Type-only imports are erased and are fine.
 *
 * Every read here uses the publishable key and goes through RLS. The secret key
 * would hand any visitor anybody's purchase history.
 */

/**
 * One embed, defined once.
 *
 * unit_price comes from order_items, frozen at purchase (#17) -- never from
 * products.price, which is what the Product costs today. The Variant and
 * Product are embedded only for display; a Product the client has since Hidden
 * drops out of the embed, because this read goes through RLS, and the line then
 * renders without a name rather than vanishing from an Order that really
 * happened.
 */
const ORDER_SELECT = `
  id,
  status,
  total,
  tracking_link,
  created_at,
  order_items (
    quantity,
    unit_price,
    variants ( color, size, products ( name ) )
  )
` as const;

export type OrderLine = {
  quantity: number;
  /** What this line was charged, at purchase time. */
  unitPrice: number;
  /** Null when the Product behind it is Hidden — the line still stands. */
  name: string | null;
  color: string | null;
  size: string | null;
};

export type ShopperOrder = {
  id: string;
  status: string;
  total: number;
  trackingLink: string | null;
  createdAt: string;
  lines: OrderLine[];
};

/** PostgREST's shape before normalisation. Embeds arrive nested and nullable. */
type OrderRow = {
  id: string;
  status: string;
  total: number;
  tracking_link: string | null;
  created_at: string;
  order_items:
    | {
        quantity: number;
        unit_price: number;
        variants: {
          color: string;
          size: string;
          products: { name: string } | null;
        } | null;
      }[]
    | null;
};

/**
 * Flattened here so no page has to cast the embed or reach three levels down
 * for a Product name. The `as unknown as` is the same one the success page was
 * doing inline: supabase-js types a nested embed as an array even where the
 * foreign key makes it at most one row.
 */
function toShopperOrder(row: OrderRow): ShopperOrder {
  return {
    id: row.id,
    status: row.status,
    total: row.total,
    trackingLink: row.tracking_link,
    createdAt: row.created_at,
    lines: (row.order_items ?? []).map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unit_price,
      name: item.variants?.products?.name ?? null,
      color: item.variants?.color ?? null,
      size: item.variants?.size ?? null,
    })),
  };
}

/**
 * This shopper's own Orders, newest first.
 *
 * The explicit user_id filter is not redundant with RLS, and removing it is a
 * privacy bug rather than a tidy-up. orders carries two select policies (#17):
 * orders_select_own AND orders_admin_all, and policies are OR'd -- so for the
 * admin account, "whatever RLS returns" is *every customer's* Orders. /profile
 * means "mine" for every account, including that one. orders_user_created_idx
 * is on (user_id, created_at desc), so this filter is also the indexed path.
 */
export async function getMyOrders(userId: string): Promise<ShopperOrder[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as OrderRow[]).map(toShopperOrder);
}

/**
 * One of this shopper's Orders, or null.
 *
 * Null covers both "no such Order" and "not yours", deliberately: the caller
 * renders the same 404 for each, so a stranger's Order id tells its holder
 * nothing about whether it exists.
 */
export async function getOrder(
  userId: string,
  orderId: string,
): Promise<ShopperOrder | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("user_id", userId)
    .eq("id", orderId)
    .maybeSingle();

  return data ? toShopperOrder(data as unknown as OrderRow) : null;
}

/**
 * The Order behind one Stripe Checkout Session, for /checkout/success (#19).
 *
 * No user filter here, on purpose and unlike the two above: that page is
 * reached by a URL Stripe builds, is documented to have no authorisation check
 * of its own, and leans on orders_select_own to decide whether a row comes
 * back. Adding a filter would change nothing for a shopper and is not worth
 * making that page's two readings of "who are you" disagree.
 */
export async function getOrderBySession(
  sessionId: string,
): Promise<ShopperOrder | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  return data ? toShopperOrder(data as unknown as OrderRow) : null;
}

// ---------------------------------------------------------------------------
// The Admin Dashboard's half (#21, ADR 0007 amended). Same embed, same module.
// ---------------------------------------------------------------------------

/** The statuses an admin may set, in the order the fulfilment flow uses them. */
export const ORDER_STATUSES = [
  "Paid",
  "Shipped",
  "Delivered",
  "Cancelled",
  "Refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * An Order as the admin sees it: everything the customer sees, plus the Stripe
 * Session id.
 *
 * That id is here because it is the only handle the client has on the parts of
 * a sale this database never stored -- the customer's email and, once
 * `shipping_address_collection` is switched on, their address. Both live in
 * Stripe. See the note in app/admin/orders/page.tsx.
 */
export type AdminOrder = ShopperOrder & { stripeSessionId: string };

type AdminOrderRow = OrderRow & { stripe_session_id: string };

/**
 * Every Order, newest first.
 *
 * Note the *absence* of the `user_id` filter that `getMyOrders` is so careful
 * to keep: here, "whatever RLS returns" is exactly right. `orders_admin_all`
 * grants the admin every row and `orders_select_own` grants any other caller
 * only their own, so a non-admin who somehow reached this function sees their
 * own purchases rather than a leak. The gate in lib/admin.ts decides what is
 * rendered; this decides nothing.
 */
export async function getAllOrders(): Promise<AdminOrder[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("orders")
    .select(`${ORDER_SELECT}, stripe_session_id`)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as AdminOrderRow[]).map((row) => ({
    ...toShopperOrder(row),
    stripeSessionId: row.stripe_session_id,
  }));
}

/**
 * A tracking link is rendered into an `href` on the customer's Order page
 * (app/profile/orders/[id]/page.tsx:77), so this is a trust boundary even
 * though the only person who can write one is the shop owner. `javascript:` and
 * `data:` URLs are what this exists to refuse; a mistyped http link is the
 * admin's problem and not this function's.
 *
 * Returns the normalised URL or null. Empty input is null rather than an error:
 * clearing a tracking link is a legitimate edit.
 */
export function parseTrackingLink(raw: string): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };

  return { ok: true, value: url.toString() };
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Mark an Order fulfilled: its Status, and its Tracking Link.
 *
 * Goes through RLS with the publishable key like everything else here -- it does
 * not need lib/supabase/admin.ts and must not use it. `orders_admin_all` is the
 * policy that permits this, and `grant update (status, tracking_link)` is
 * column-scoped, so even an admin cannot move `total` or `user_id` through this
 * path however the request is shaped. That grant is the real guarantee; the two
 * parsers above are so the admin gets an error instead of a silent no-op.
 *
 * Returns whether a row was actually updated, so the caller can tell "saved"
 * from "that Order is not yours / does not exist" rather than assuming.
 */
export async function setOrderFulfilment(
  orderId: string,
  status: OrderStatus,
  trackingLink: string | null,
): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("orders")
    .update({ status, tracking_link: trackingLink })
    .eq("id", orderId)
    .select("id");

  return (data ?? []).length === 1;
}

// ---------------------------------------------------------------------------
// Display helpers. Pure, and shared so three pages format one Order the same.
// ---------------------------------------------------------------------------

/**
 * Money formatting and line arithmetic come from lib/cart.ts and are re-exported
 * here, so an Order page keeps a single import while `$` and `unitPrice *
 * quantity` still have exactly one implementation each in the codebase.
 */
export { lineTotal, money } from "./cart";

/**
 * The uuid in full is unusable over the phone or in an email. The first block
 * is plenty to find one Order among a shop's worth.
 */
export function orderReference(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

export function orderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
