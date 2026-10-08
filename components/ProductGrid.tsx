import React from "react";
import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog";
import { categoryLabel } from "@/lib/taxonomy";

export default function ProductGrid({ products }: { products: CatalogProduct[] }) {
  if (products.length === 0) {
    return (
      <p className="font-belleza text-ssuni-slate text-center py-24">
        Nothing here just yet — new pieces are on their way.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-12">
      {products.map((product) => (
        <Link
          key={product.id}
          href={`/catalog/${product.slug}`}
          className="group flex flex-col cursor-pointer"
        >
          {/* Image Container with 3:4 Aspect Ratio */}
          <div className="relative w-full aspect-[3/4] mb-4 overflow-hidden bg-ssuni-light2">
            <Image
              src={product.imageUrl ?? "/images/download.jpeg"}
              alt={product.name}
              fill
              // Mirrors the grid-cols classes below (1 / 2 / 3 / 4). Keep the
              // two in step: out of sync, the browser picks the wrong size and
              // the optimization is worse than none.
              sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
              className={`object-cover transition-transform duration-700 group-hover:scale-105 ${
                product.isHidden ? "opacity-40" : ""
              }`}
            />
            {/* 'New' Badge Overlay */}
            {product.isNew && (
              <span className="absolute top-3 left-3 bg-ssuni-light1 text-ssuni-brown px-3 py-1 text-xs font-belleza tracking-widest uppercase">
                New
              </span>
            )}
            {/* Only an admin can be looking at this.
                `products_select_public` is `not is_hidden or is_admin()`, so a
                Hidden Product reaching the grid at all proves who is asking --
                which is why there is no session check here. Bottom left, away
                from 'New': a Product can be both, and the two say different
                kinds of thing. The faded image is the part that reads at a
                glance down a grid; the pill is what makes it unambiguous. */}
            {product.isHidden && (
              <span className="absolute bottom-3 left-3 bg-ssuni-brown text-ssuni-light1 px-3 py-1 text-xs font-belleza tracking-widest uppercase">
                Hidden
              </span>
            )}
          </div>

          {/* Product Details */}
          <div className="flex flex-col text-center">
            <span className="text-xs font-belleza text-stone-500 uppercase tracking-widest mb-1">
              {categoryLabel(product.category)}
            </span>
            <h3 className="font-cinzel text-lg tracking-wide text-ssuni-brown mb-1">
              {product.name}
            </h3>
            <span className="font-belleza text-stone-700">
              ${product.price.toFixed(2)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
