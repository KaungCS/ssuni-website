import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AwaitingOrder, ClearCart } from "@/components/CheckoutSuccess";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Stripe returns the shopper after payment (#19). The URL is
 * success_url in app/api/checkout/route.ts; Stripe substitutes the real id for
 * {CHECKOUT_SESSION_ID}.
 *
 * A server component, because the authorisation here is RLS and nothing else.
 * The Order is looked up by the session id in the query string -- which anyone
 * could paste -- and orders_select_own (#17) is what decides whether the
 * visitor gets a row back. There is no check in this file for that reason: a
 * shopper who did not place this Order sees the same "still confirming" state
 * as one whose webhook is a second behind, and learns nothing either way.
 *
 * Nothing here is verified against Stripe's API. Landing on this URL is not
 * proof of payment and is not treated as any: the Order exists because the
 * signed webhook created it (#18), or it does not exist yet.
 */

export const metadata: Metadata = {
  title: "Order Confirmed — SSUNI",
};

// The Order appears partway through this page's own lifetime, which is the one
// thing a cached render cannot represent.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type OrderLine = {
  quantity: number;
  unit_price: number;
  variants: { color: string; size: string; products: { name: string } | null } | null;
};

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sessionId = (await searchParams).session_id;
  if (typeof sessionId !== "string" || sessionId === "") notFound();

  const supabase = await createClient();

  // The publishable key, so this runs as the signed-in shopper and RLS scopes
  // it to their own Orders. Never the secret key -- that would hand any pasted
  // session id somebody else's purchase.
  //
  // Queried inline rather than through a lib/orders.ts: this is the only caller
  // today. /profile (#20) is the second, and is where extracting it pays.
  const { data: order } = await supabase
    .from("orders")
    .select(
      `
      id,
      total,
      created_at,
      order_items (
        quantity,
        unit_price,
        variants ( color, size, products ( name ) )
      )
    `,
    )
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (!order) {
    return (
      <SuccessShell heading="Thank you">
        <AwaitingOrder />
      </SuccessShell>
    );
  }

  // The uuid in full is unusable over the phone or in an email. The first block
  // is plenty to find one Order among a shop's worth.
  const reference = order.id.slice(0, 8).toUpperCase();
  const lines = (order.order_items ?? []) as unknown as OrderLine[];

  return (
    <SuccessShell heading="Thank you">
      <ClearCart />

      <p className="font-belleza text-ssuni-slate mb-10">
        Your order is confirmed. A receipt is on its way to your email.
      </p>

      <dl className="border-t border-ssuni-light2 pt-6 mb-10 font-belleza text-sm">
        <div className="flex justify-between py-1">
          <dt className="uppercase tracking-widest text-xs text-ssuni-slate">Order</dt>
          <dd className="text-ssuni-brown">{reference}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="uppercase tracking-widest text-xs text-ssuni-slate">Placed</dt>
          <dd className="text-ssuni-brown">
            {new Date(order.created_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </dd>
        </div>
      </dl>

      <ul className="border-t border-ssuni-light2">
        {lines.map((line, index) => (
          <li
            // No id is selected for order_items, and a Variant can legitimately
            // appear once only -- so the index is stable for a list that never
            // reorders or changes length.
            key={index}
            className="flex justify-between gap-6 border-b border-ssuni-light2 py-4 font-belleza"
          >
            <span className="text-ssuni-brown">
              {/* A Variant whose Product has since been Hidden drops out of the
                  embed, because this read goes through RLS. The line still
                  happened and is still owed, so it renders without its name
                  rather than vanishing from the Order. */}
              {line.variants?.products?.name ?? "Item"}
              {line.variants && (
                <span className="text-ssuni-slate">
                  {" "}
                  — {line.variants.color} / {line.variants.size}
                </span>
              )}
              <span className="text-ssuni-slate"> × {line.quantity}</span>
            </span>
            <span className="text-ssuni-brown whitespace-nowrap">
              {money(line.unit_price * line.quantity)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-widest font-belleza text-ssuni-slate">
          Total
        </span>
        {/* orders.total, what Stripe charged -- not a sum of the lines above.
            They agree today; once shipping or tax exists they will not, and the
            number the customer's card saw is the one to show. */}
        <span className="font-cinzel text-2xl text-ssuni-brown">{money(order.total)}</span>
      </div>

      <div className="mt-12">
        <Link
          href="/catalog"
          className="border border-ssuni-brown px-8 py-3 text-xs uppercase tracking-widest font-belleza hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors"
        >
          Continue shopping
        </Link>
      </div>
    </SuccessShell>
  );
}

function SuccessShell({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-2xl mx-auto px-6 text-ssuni-brown">
        <h1 className="font-cinzel text-4xl mb-6">{heading}</h1>
        {children}
      </div>
    </div>
  );
}
