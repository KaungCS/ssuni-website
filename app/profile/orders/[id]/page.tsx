import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getOrder,
  money,
  orderDate,
  orderReference,
  type OrderLine,
} from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";

/**
 * One Order, in full. Issue #20.
 *
 * A receipt rather than a status line: what was bought, at what each line
 * actually cost, where it is, and the Tracking Link once there is one. It is
 * also where a Cancel, a return request or a review would hang -- none of which
 * exist yet, and each of which is a real decision (does a cancel refund through
 * Stripe? does it restock?) rather than a button.
 */

export const metadata: Metadata = {
  title: "Order — SSUNI",
};

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/profile/orders/${id}`)}`);
  }

  const order = await getOrder(user.id, id);

  // Somebody else's Order id and a made-up one produce the same 404, which is
  // the point: the shopper holding a stranger's link learns nothing about
  // whether it names a real purchase.
  if (!order) notFound();

  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-2xl mx-auto px-6 text-ssuni-brown">
        <Link
          href="/profile"
          className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors"
        >
          ← All orders
        </Link>

        <h1 className="font-cinzel text-4xl mt-6 mb-10">
          Order {orderReference(order.id)}
        </h1>

        <dl className="border-t border-ssuni-light2 pt-6 mb-10 font-belleza text-sm">
          <Row label="Placed">{orderDate(order.createdAt)}</Row>
          <Row label="Status">{order.status}</Row>
          {order.trackingLink && (
            <Row label="Tracking">
              {/* The client types this into Supabase Studio or /admin/orders
                  (#21), so it is arbitrary text from outside the app. rel
                  keeps a carrier's page off window.opener; target is a
                  courtesy, not a security measure. */}
              <a
                href={order.trackingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-70 transition-opacity break-all"
              >
                Track this parcel
              </a>
            </Row>
          )}
        </dl>

        <ul className="border-t border-ssuni-light2">
          {order.lines.map((line, index) => (
            // No id is selected for order_items, and this list never reorders
            // or changes length -- an Order's contents are fixed at purchase.
            <LineItem key={index} line={line} />
          ))}
        </ul>

        <div className="mt-8 flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-widest font-belleza text-ssuni-slate">
            Total
          </span>
          {/* orders.total, what Stripe charged -- not a sum of the lines above.
              They agree today; once shipping or tax exists they will not, and
              the number the customer's card saw is the one to show. */}
          <span className="font-cinzel text-2xl text-ssuni-brown">
            {money(order.total)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-1">
      <dt className="uppercase tracking-widest text-xs text-ssuni-slate">{label}</dt>
      <dd className="text-ssuni-brown text-right">{children}</dd>
    </div>
  );
}

function LineItem({ line }: { line: OrderLine }) {
  return (
    <li className="flex justify-between gap-6 border-b border-ssuni-light2 py-4 font-belleza">
      <span className="text-ssuni-brown">
        {/* A Variant whose Product has since been Hidden drops out of the
            embed, because this read goes through RLS. The line still happened
            and was still paid for, so it renders without its name rather than
            vanishing from the Order. */}
        {line.name ?? "Item"}
        {line.color && line.size && (
          <span className="text-ssuni-slate">
            {" "}
            — {line.color} / {line.size}
          </span>
        )}
        <span className="text-ssuni-slate"> × {line.quantity}</span>
      </span>
      <span className="text-ssuni-brown whitespace-nowrap">
        {money(line.unitPrice * line.quantity)}
      </span>
    </li>
  );
}
