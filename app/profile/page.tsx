import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getMyOrders,
  money,
  orderDate,
  orderReference,
  type ShopperOrder,
} from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";

/**
 * The shopper's own Order history. Issue #20.
 *
 * Linked from components/NavBar.tsx since before there were Orders, and 404ing
 * until now.
 *
 * Deliberately not the Admin Dashboard (#21, ADR 0007): this page answers "did
 * my thing ship", for one account. getMyOrders filters on user_id rather than
 * leaning on RLS alone, because the admin account satisfies orders_admin_all
 * too and would otherwise find every customer's purchases here.
 */

export const metadata: Metadata = {
  title: "Your Orders — SSUNI",
};

// Order Status changes while the shopper is not looking -- the client marks an
// Order Shipped in Supabase Studio or /admin/orders. A cached render is a
// customer told their parcel has not moved when it has.
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();

  // getUser() rather than getSession(), matching app/api/checkout/route.ts:
  // this decides which user_id the query filters on, so it has to be verified
  // with Supabase rather than taken from what the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The same login gate #16 put in front of checkout, reusing the ?next=
  // round-trip app/login/page.tsx already guards against open redirects.
  if (!user) redirect(`/login?next=${encodeURIComponent("/profile")}`);

  const orders = await getMyOrders(user.id);

  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-2xl mx-auto px-6 text-ssuni-brown">
        <h1 className="font-cinzel text-4xl mb-2">Your Orders</h1>
        <p className="font-belleza text-ssuni-slate mb-12">{user.email}</p>

        {orders.length === 0 ? (
          <div className="border-t border-ssuni-light2 pt-10">
            <p className="font-belleza text-ssuni-slate mb-8">
              You haven&apos;t placed an order yet.
            </p>
            <Link
              href="/catalog"
              className="border border-ssuni-brown px-8 py-3 text-xs uppercase tracking-widest font-belleza hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors"
            >
              Browse the shop
            </Link>
          </div>
        ) : (
          <ul className="border-t border-ssuni-light2">
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function OrderRow({ order }: { order: ShopperOrder }) {
  // One line of what is in it, so the list is scannable without opening
  // anything. The detail page is where the full receipt lives.
  const count = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <li className="border-b border-ssuni-light2">
      <Link
        href={`/profile/orders/${order.id}`}
        className="flex items-baseline justify-between gap-6 py-6 hover:opacity-70 transition-opacity"
      >
        <span>
          <span className="font-belleza block text-ssuni-brown">
            {orderReference(order.id)}
          </span>
          <span className="font-belleza block text-sm text-ssuni-slate">
            {orderDate(order.createdAt)} · {count} {count === 1 ? "item" : "items"}
          </span>
        </span>

        <span className="text-right whitespace-nowrap">
          <span className="font-belleza block text-xs uppercase tracking-widest text-ssuni-slate">
            {order.status}
          </span>
          <span className="font-belleza block text-ssuni-brown">
            {money(order.total)}
          </span>
        </span>
      </Link>
    </li>
  );
}
