"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { isOrderStatus, parseTrackingLink, setOrderFulfilment } from "@/lib/orders";

/**
 * Mark one Order fulfilled. Issue #21.
 *
 * `requireAdmin()` is called again here and that is not belt-and-braces with the
 * layout: a Server Action is a POST endpoint that anybody can call directly, and
 * the layout that rendered the form is not in the request path. Forgetting this
 * would leave the *gate* on the page and the *action* open to any signed-in
 * shopper -- which RLS would still refuse, since `orders_admin_all` is what
 * permits the write, but a 404 is a better answer than a silent no-op.
 *
 * Feedback goes back as a query parameter rather than through `useActionState`,
 * so this page needs no client component and keeps working with JavaScript off
 * -- the same trade `components/CatalogFilterDrawer.tsx` makes. The visible
 * result of a successful save is the row itself re-rendering with the new
 * values; `force-dynamic` on the layout means there is no cache to invalidate.
 */
export async function updateOrderFulfilment(formData: FormData) {
  await requireAdmin();

  const orderId = String(formData.get("orderId") ?? "");
  const rawStatus = String(formData.get("status") ?? "");
  const rawTracking = String(formData.get("trackingLink") ?? "");

  if (!orderId) redirect("/admin/orders?error=missing");

  if (!isOrderStatus(rawStatus)) {
    redirect(`/admin/orders?error=status&order=${encodeURIComponent(orderId)}`);
  }

  const tracking = parseTrackingLink(rawTracking);
  if (!tracking.ok) {
    redirect(`/admin/orders?error=tracking&order=${encodeURIComponent(orderId)}`);
  }

  const updated = await setOrderFulfilment(orderId, rawStatus, tracking.value);

  redirect(
    updated
      ? `/admin/orders?saved=${encodeURIComponent(orderId)}`
      : `/admin/orders?error=notfound&order=${encodeURIComponent(orderId)}`,
  );
}
