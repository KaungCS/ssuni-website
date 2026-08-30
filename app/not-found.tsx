import Link from "next/link";

/**
 * Rendered whenever a route calls notFound(), and for unmatched URLs. Keeps the
 * 404 on-brand instead of dropping the visitor onto the stock Next.js page.
 * #25 covers wider empty-state and 404 polish.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center font-belleza text-ssuni-brown px-6">
      <div className="text-center">
        <h1 className="font-cinzel text-3xl mb-3">Not Found</h1>
        <p className="text-ssuni-slate mb-6">
          This piece may have sold out or moved.
        </p>
        <Link
          href="/catalog"
          className="text-xs uppercase tracking-widest underline hover:text-ssuni-slate transition-colors"
        >
          Return to Catalog
        </Link>
      </div>
    </div>
  );
}
