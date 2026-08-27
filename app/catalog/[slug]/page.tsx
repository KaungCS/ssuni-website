import { notFound } from "next/navigation";
import ProductDetail from "@/components/ProductDetail";
import { getProductBySlug } from "@/lib/catalog";

// Fully dynamic on purpose -- see the note in app/catalog/page.tsx. Stock shown
// here is what the shopper is about to act on, so it must not be cached.
export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  // A missing Product is a real 404. Previously this page rendered its own
  // "Product Not Found" body with an HTTP 200, which tells a crawler the page
  // exists and is fine.
  if (!product) notFound();

  return <ProductDetail product={product} />;
}
