import {
  ORDER_STATUSES,
  getAllOrders,
  lineTotal,
  money,
  orderDate,
  orderReference,
  type AdminOrder,
} from "@/lib/orders";
import { updateOrderFulfilment } from "./actions";

/**
 * Every Order, and the two fields the client can change about one. Issue #21,
 * per ADR 0007 (amended 2026-09-19).
 *
 * The minimum that makes a sale fulfillable: see what was bought, mark it
 * Shipped, and put a Tracking Link on it -- which then appears on the
 * customer's own Order page, because /profile reads the same row.
 *
 * Each row is a plain <form> posting to a Server Action. No client component,
 * no controlled inputs: the saved result *is* the re-rendered row, so there is
 * nothing for React state to hold. This also keeps the page working with
 * JavaScript disabled, the same trade CatalogFilterDrawer makes.
 *
 * Reads go through RLS with the publishable key. `orders_admin_all` returns
 * every row to the admin and `orders_select_own` returns only their own to
 * anybody else, so this page needs no `user_id` filter -- and deliberately has
 * none, unlike getMyOrders. See lib/orders.ts.
 */

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; order?: string }>;
}) {
  const { saved, error, order: errorOrderId } = await searchParams;
  const orders = await getAllOrders();

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-8">
        <h2 className="font-cinzel text-2xl">Orders</h2>
        <p className="font-belleza text-sm text-ssuni-slate">
          {orders.length} {orders.length === 1 ? "order" : "orders"}
        </p>
      </div>

      {error && <Banner tone="error">{errorMessage(error)}</Banner>}
      {saved && !error && (
        <Banner tone="ok">Order {orderReference(saved)} updated.</Banner>
      )}

      {/* The client sees this before their first sale, and again if RLS ever
          stops returning rows -- which is why it says what it means rather
          than just "no orders". */}
      {orders.length === 0 ? (
        <p className="font-belleza text-ssuni-slate border-t border-ssuni-light2 pt-10">
          No orders yet. They appear here the moment Stripe confirms a payment.
        </p>
      ) : (
        <ul className="border-t border-ssuni-light2">
          {orders.map((o) => (
            <AdminOrderRow
              key={o.id}
              order={o}
              invalid={error !== undefined && errorOrderId === o.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function errorMessage(code: string): string {
  if (code === "tracking") return "That tracking link is not a valid http(s) URL — nothing was saved.";
  if (code === "status") return "That is not a known Order Status — nothing was saved.";
  if (code === "notfound") return "That Order no longer exists — nothing was saved.";
  return "Something was missing from that request — nothing was saved.";
}

function Banner({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  return (
    <p
      role="status"
      className={`font-belleza text-sm px-4 py-3 mb-8 border ${
        tone === "ok"
          ? "border-ssuni-sage text-ssuni-brown bg-ssuni-sage/10"
          : "border-ssuni-brown text-ssuni-brown bg-ssuni-light2"
      }`}
    >
      {children}
    </p>
  );
}

function AdminOrderRow({ order, invalid }: { order: AdminOrder; invalid: boolean }) {
  return (
    <li className="border-b border-ssuni-light2 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mb-4">
        <span>
          <span className="font-belleza block text-ssuni-brown">
            {orderReference(order.id)}
          </span>
          <span className="font-belleza block text-sm text-ssuni-slate">
            {orderDate(order.createdAt)}
          </span>
        </span>
        <span className="font-belleza text-ssuni-brown">{money(order.total)}</span>
      </div>

      <ul className="font-belleza text-sm text-ssuni-slate mb-5 space-y-1">
        {order.lines.map((line, i) => (
          // Index as key: an Order's lines never reorder or change length --
          // order_items is written once, by the webhook, inside one transaction.
          <li key={i} className="flex justify-between gap-4">
            <span>
              {/* Null when the Product behind the line is Hidden. The line still
                  stands: it records a sale that happened. */}
              {line.name ?? "(hidden product)"}
              {line.color && line.size ? ` — ${line.color} / ${line.size}` : ""}
              {` × ${line.quantity}`}
            </span>
            <span className="whitespace-nowrap">
              {money(lineTotal(line.unitPrice, line.quantity))}
            </span>
          </li>
        ))}
      </ul>

      {/* The customer's email and shipping address are NOT in this database --
          they are in Stripe, and checkout does not currently request an address
          at all. The Session id is the handle for looking a sale up there. */}
      <p className="font-belleza text-xs text-ssuni-slate mb-5 break-all">
        Stripe session: <span className="text-ssuni-brown">{order.stripeSessionId}</span>
      </p>

      <form
        action={updateOrderFulfilment}
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="orderId" value={order.id} />

        <label className="flex flex-col gap-1">
          <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
            Status
          </span>
          {/* defaultValue, not value: uncontrolled on purpose -- see the file
              docblock. The browser keeps the admin's edit until they submit. */}
          <select
            name="status"
            defaultValue={order.status}
            className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm cursor-pointer"
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 grow min-w-[16rem]">
          <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
            Tracking link
          </span>
          <input
            type="url"
            name="trackingLink"
            defaultValue={order.trackingLink ?? ""}
            placeholder="https://…  (leave blank to clear)"
            aria-invalid={invalid || undefined}
            className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm aria-[invalid]:border-ssuni-brown"
          />
        </label>

        <button
          type="submit"
          className="bg-ssuni-brown text-ssuni-light1 px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-slate transition-colors cursor-pointer"
        >
          Save
        </button>
      </form>
    </li>
  );
}
