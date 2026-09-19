import type { Metadata } from "next";
import { Cinzel, Belleza } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import NavBar from "@/components/NavBar"; // Import the new NavBar component
import { CartProvider } from "@/components/CartProvider";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/site";

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
  weight: ["400", "600", "700"],
});

const belleza = Belleza({
  subsets: ["latin"],
  variable: "--font-belleza",
  weight: ["400"],
});

export const metadata: Metadata = {
  // Resolves every relative URL in metadata below and in each page's own
  // generateMetadata -- Open Graph images in particular, which have to be
  // absolute for a crawler that has never seen our origin. See lib/site.ts for
  // why NEXT_PUBLIC_SITE_URL has to be a Cloudflare BUILD variable.
  metadataBase: new URL(SITE_URL),
  description: "Soft days and quiet elegance.",
  title: "SSUNI | Official Store",
  icons: {
    icon: "/images/ssuni-logo-white-bg.png",
  },
  openGraph: {
    siteName: "SSUNI",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cinzel.variable} ${belleza.variable}`}>
      <body className="font-belleza antialiased selection:bg-ssuni-brown selection:text-ssuni-light1 flex flex-col min-h-screen">

        {/* The Cart is guest-local and lives in localStorage (ADR 0001), so it
            wraps the whole app rather than any one route: the nav badge and
            /cart read the same provider. */}
        <CartProvider>

          {/* Insert the decoupled NavBar component */}
          <NavBar />

          {/* Main Page Content */}
          <main className="flex-grow">{children}</main>

        </CartProvider>

        {/* The footer. More than decoration: Stripe's live-mode account review
            (#26) looks at the public site for contact details and for the
            refund/returns and terms policies, so this is on the path to taking
            real money rather than just to looking finished. */}
        <footer className="bg-ssuni-light2 border-t border-ssuni-light1 text-ssuni-brown">
          <div className="max-w-7xl mx-auto px-6 py-14">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-10 text-left">

              <div className="col-span-2 md:col-span-1">
                <p className="font-cinzel tracking-widest text-lg mb-3">SSUNI</p>
                <p className="font-belleza text-sm opacity-70 max-w-xs">
                  Soft days and quiet elegance.
                </p>
              </div>

              <nav aria-labelledby="footer-shop">
                <h2
                  id="footer-shop"
                  className="font-belleza uppercase tracking-widest text-xs mb-4 opacity-60"
                >
                  Shop
                </h2>
                <ul className="space-y-2 font-belleza text-sm">
                  {/* Hrefs match components/ShopDropdown.tsx exactly -- the same
                      params app/catalog/page.tsx parses (#10). A footer link
                      inventing its own query string is a dead link that still
                      renders a page. */}
                  <li><Link href="/catalog" className="hover:opacity-70 transition-opacity">Shop All</Link></li>
                  <li><Link href="/catalog?new=true" className="hover:opacity-70 transition-opacity">New Arrivals</Link></li>
                  <li><Link href="/catalog?collection=best-sellers" className="hover:opacity-70 transition-opacity">Best Sellers</Link></li>
                </ul>
              </nav>

              <nav aria-labelledby="footer-account">
                <h2
                  id="footer-account"
                  className="font-belleza uppercase tracking-widest text-xs mb-4 opacity-60"
                >
                  Account
                </h2>
                <ul className="space-y-2 font-belleza text-sm">
                  <li><Link href="/profile" className="hover:opacity-70 transition-opacity">Orders</Link></li>
                  <li><Link href="/cart" className="hover:opacity-70 transition-opacity">Cart</Link></li>
                </ul>
              </nav>

              <div>
                <h2 className="font-belleza uppercase tracking-widest text-xs mb-4 opacity-60">
                  Help
                </h2>
                <ul className="space-y-2 font-belleza text-sm">
                  <li>
                    <a
                      href={`mailto:${CONTACT_EMAIL}`}
                      className="hover:opacity-70 transition-opacity break-all"
                    >
                      {CONTACT_EMAIL}
                    </a>
                  </li>
                  {/* Privacy, Terms and Shipping & Returns link from here in
                      #23, which is where those pages get generated (ADR 0006).
                      Deliberately NOT linked yet: a footer link to a route that
                      404s is worse than a footer without one. */}
                </ul>
              </div>

            </div>

            <p className="mt-12 pt-6 border-t border-ssuni-light1 text-xs tracking-wider opacity-70 font-belleza text-center">
              © {new Date().getFullYear()} SSUNI. All rights reserved.
            </p>
          </div>
        </footer>

      </body>
    </html>
  );
}