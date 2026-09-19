import { createClient } from "./supabase/server";

/**
 * The only place the storefront reads Orders. Issue #20.
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
