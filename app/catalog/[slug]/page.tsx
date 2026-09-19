import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductDetail from "@/components/ProductDetail";
import { getProductBySlug } from "@/lib/catalog";

// Fully dynamic on purpose -- see the note in app/catalog/page.tsx. Stock shown
// here is what the shopper is about to act on, so it must not be cached.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/**
 * What a shared Product link looks like in a message, a post, or a search
 * result. Without this every Product previewed as the site-wide "SSUNI |
 * Official Store" with no image -- which for a clothing brand is the link people
 * actually send each other.
 *
 * `getProductBySlug` is memoised per request (React `cache`), so this and the
 * page body below cost one query between them, not two.
 *
 * The `openGraph.images` path may be relative ('/images/download.jpeg' until
 * #11); `metadataBase` in app/layout.tsx is what makes Next resolve it to the
 * absolute URL a crawler needs.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  // Deliberately not calling notFound() here. Next renders metadata and the page
  // body concurrently, and letting the body own the 404 keeps one reason for it
  // in one place.
  if (!product) return { title: "Not Found | SSUNI" };

  const description =
    product.description ?? `${product.name}, $${product.price.toFixed(2)}, from SSUNI.`;

  return {
    title: `${product.name} | SSUNI`,
    description,
    openGraph: {
      title: product.name,
      description,
      type: "website",
      url: `/catalog/${product.slug}`,
      images: product.imageUrl ? [{ url: product.imageUrl, alt: product.name }] : undefined,
    },
  };
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  // A missing Product is a real 404. Previously this page rendered its own
  // "Product Not Found" body with an HTTP 200, which tells a crawler the page
  // exists and is fine.
  if (!product) notFound();

  return <ProductDetail product={product} />;
}
