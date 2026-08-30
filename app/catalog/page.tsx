import ProductGrid from "@/components/ProductGrid";
import { getProducts } from "@/lib/catalog";

// Fully dynamic on purpose: stock changes, and a cached "Few Left" badge is a
// lie told to a paying customer. The catalog is placeholder seed data today
// (#5) -- do not size this decision on the current row count. Once the client
// loads a real catalog and traffic is non-trivial, revisit: `export const
// revalidate = 60` here, plus OpenNext's KV incremental cache in
// open-next.config.ts, is the upgrade path.
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const products = await getProducts();

  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-7xl mx-auto px-6">
        
        {/* Page Header & Filter Utility Bar */}
        <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-ssuni-brown/20 pb-6 mb-12">
          <div>
            <h1 className="font-cinzel text-4xl md:text-5xl text-ssuni-brown mb-2">
              Shop All
            </h1>
            <p className="font-belleza text-stone-600 tracking-wide">
              The complete collection.
            </p>
          </div>
          
          {/* Placeholder for future filtering logic */}
          <div className="mt-6 md:mt-0">
            <button className="font-belleza uppercase tracking-widest text-sm text-ssuni-brown hover:opacity-70 transition-opacity border-b border-ssuni-brown pb-1">
              Filter & Sort +
            </button>
          </div>
        </div>

        {/* The Grid */}
        <ProductGrid products={products} />
        
      </div>
    </div>
  );
}