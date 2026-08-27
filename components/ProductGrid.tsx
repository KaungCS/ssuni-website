import React from "react";
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
            <img
              src={product.imageUrl ?? "/images/download.jpeg"}
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            {/* 'New' Badge Overlay */}
            {product.isNew && (
              <span className="absolute top-3 left-3 bg-ssuni-light1 text-ssuni-brown px-3 py-1 text-xs font-belleza tracking-widest uppercase">
                New
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
