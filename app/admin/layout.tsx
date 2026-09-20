import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

/**
 * The Admin Dashboard shell. Issue #21, per ADR 0007 (amended 2026-09-19).
 *
 * The gate lives here rather than in each page on purpose: a page added later
 * that forgets to call `requireAdmin()` is a hole, and a layout cannot be
 * forgotten. Steps 3 and 4 of the weeks 5-6 plan (Products, Hero Stories) hang
 * off this same shell.
 *
 * `noindex` because this is a real URL on a public domain. The 404 for
 * non-admins already makes it uninteresting, but a search result pointing at
 * the shop's admin is an invitation regardless.
 */

export const metadata: Metadata = {
  title: "Admin — SSUNI",
  robots: { index: false, follow: false },
};

// Nothing on the dashboard is ever safely cached: the client is looking at it
// precisely because something changed.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects when signed out, 404s when signed in and not an admin. Its return
  // value is unused here -- pages read the user themselves if they need it.
  await requireAdmin();

  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-5xl mx-auto px-6 text-ssuni-brown">
        <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-ssuni-light2 pb-6 mb-10">
          <h1 className="font-cinzel text-3xl">Shop Admin</h1>
          <nav className="flex gap-6 font-belleza text-xs uppercase tracking-widest">
            <Link href="/admin/orders" className="hover:text-ssuni-slate transition-colors">
              Orders
            </Link>
            <Link href="/admin/products" className="hover:text-ssuni-slate transition-colors">
              Products
            </Link>
            <Link href="/catalog" className="text-ssuni-slate hover:text-ssuni-brown transition-colors">
              View shop
            </Link>
          </nav>
        </header>

        {children}
      </div>
    </div>
  );
}
