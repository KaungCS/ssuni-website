import { redirect } from "next/navigation";

/**
 * The dashboard root exists so lib/admin.ts has somewhere to send a signed-out
 * admin back to. A layout cannot see the requested pathname, so `?next=` points
 * here and this forwards on.
 */
export default function AdminIndexPage() {
  redirect("/admin/orders");
}
