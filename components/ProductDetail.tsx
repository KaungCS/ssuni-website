"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog";

// A quick helper to map color names to hex codes/Tailwind classes for the swatches
const getColorSwatch = (colorName: string) => {
  const map: Record<string, string> = {
    Espresso: "bg-ssuni-brown",
    Bone: "bg-[#D9D3C7]",
    Natural: "bg-ssuni-light2",
    Sage: "bg-ssuni-sage",
    Slate: "bg-ssuni-slate",
  };
  return map[colorName] || "bg-gray-300";
};

/**
 * The interactive half of the product detail page. The server component in
 * app/catalog/[slug]/page.tsx does the fetching and the 404; this holds the
 * selection state, which has to live in the browser.
 *
 * Stock here is Available Stock (ADR 0010), already computed by the database --
 * see lib/catalog.ts. Do not swap it for a raw stock count.
 *
 * The Add to Cart button is still inert. #12 adds the Cart provider and #13
 * wires this button to it.
 */
export default function ProductDetail({ product }: { product: CatalogProduct }) {
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  const availableColors = useMemo(() => {
    const colors = product.variants.map((v) => v.color);
    return Array.from(new Set(colors));
  }, [product]);

  const availableSizes = useMemo(() => {
    if (!selectedColor) return [];
    return product.variants.filter((v) => v.color === selectedColor);
  }, [product, selectedColor]);

  const selectedVariant = useMemo(() => {
    return availableSizes.find((v) => v.size === selectedSize);
  }, [availableSizes, selectedSize]);

  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-20">

        {/* Left Column: Product Image Gallery */}
        <div className="flex flex-col gap-4">
          <div className="w-full aspect-[3/4] bg-ssuni-light2 relative overflow-hidden">
            <img
              src={product.imageUrl ?? "/images/download.jpeg"}
              alt={product.name}
              className="w-full h-full object-cover"
            />
            {/* Added a Sage accent tag for 'New' items */}
            {product.isNew && (
              <span className="absolute top-4 left-4 bg-ssuni-sage text-white px-4 py-1.5 text-xs font-belleza tracking-widest uppercase shadow-sm">
                New Arrival
              </span>
            )}
          </div>
        </div>

        {/* Right Column: Product Details & Form */}
        <div className="flex flex-col text-ssuni-brown mt-4 md:mt-0">
          <Link href="/catalog" className="text-xs uppercase tracking-widest font-belleza mb-6 text-ssuni-slate hover:text-ssuni-brown transition-colors">
            ← Back to Shop
          </Link>

          <h1 className="font-cinzel text-4xl mb-2">{product.name}</h1>
          <p className="font-belleza text-xl mb-6">${product.price.toFixed(2)}</p>
          <p className="font-belleza text-ssuni-slate leading-relaxed mb-10">
            {product.description}
          </p>

          {/* Color Selector */}
          <div className="mb-8">
            <h3 className="font-belleza uppercase tracking-widest text-xs mb-3">
              Color {selectedColor && <span className="text-ssuni-slate normal-case tracking-normal ml-2">— {selectedColor}</span>}
            </h3>
            <div className="flex gap-3">
              {availableColors.map((color) => (
                <button
                  key={color}
                  onClick={() => {
                    setSelectedColor(color);
                    setSelectedSize(null);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 font-belleza text-sm border transition-all ${
                    selectedColor === color
                      ? "border-ssuni-brown bg-ssuni-light2 text-ssuni-brown shadow-sm"
                      : "border-ssuni-slate/30 text-ssuni-slate hover:border-ssuni-brown/50"
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded-full border border-black/10 ${getColorSwatch(color)}`} />
                  {color}
                </button>
              ))}
            </div>
          </div>

          {/* Size Selector */}
          <div className="mb-10">
            <div className="flex justify-between items-end mb-3">
              <h3 className="font-belleza uppercase tracking-widest text-xs">Size</h3>
              <button className="font-belleza text-xs underline text-ssuni-slate hover:text-ssuni-brown transition-colors">
                Size Guide
              </button>
            </div>

            <div className="flex flex-wrap gap-3">
              {selectedColor ? (
                availableSizes.map((variant) => {
                  const isOutOfStock = variant.availableStock === 0;
                  const isLowStock = variant.availableStock > 0 && variant.availableStock <= 5;

                  return (
                    <div key={variant.size} className="flex flex-col items-center gap-1">
                      <button
                        disabled={isOutOfStock}
                        onClick={() => setSelectedSize(variant.size)}
                        className={`w-12 h-12 flex items-center justify-center font-belleza text-sm border transition-all ${
                          isOutOfStock
                            ? "opacity-40 cursor-not-allowed border-ssuni-slate/20 bg-transparent text-ssuni-slate line-through"
                            : selectedSize === variant.size
                              ? "border-ssuni-brown bg-ssuni-brown text-ssuni-light1 shadow-sm"
                              : "border-ssuni-slate/30 text-ssuni-brown hover:border-ssuni-slate"
                        }`}
                      >
                        {variant.size}
                      </button>
                      {/* Sub-label for low stock using brand sage/slate */}
                      {isLowStock && (
                        <span className="text-[10px] text-ssuni-sage font-belleza tracking-wider uppercase">
                          Few Left
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="font-belleza text-sm text-ssuni-slate">Please select a color first.</p>
              )}
            </div>
          </div>

          {/* Add to Cart Button */}
          <button
            disabled={!selectedColor || !selectedSize || selectedVariant?.availableStock === 0}
            className="w-full bg-ssuni-brown text-ssuni-light1 py-4 font-belleza uppercase tracking-widest text-sm hover:bg-ssuni-slate transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ssuni-brown"
          >
            {selectedVariant?.availableStock === 0 ? "Out of Stock" : "Add to Cart"}
          </button>

          {/* Product Accords / Extra Details */}
          <div className="mt-12 border-t border-ssuni-slate/20 pt-6">
            <h4 className="font-cinzel text-sm tracking-wider mb-2 text-ssuni-brown">Shipping & Returns</h4>
            <p className="font-belleza text-sm text-ssuni-slate">
              Free shipping on domestic orders over $150. Returns accepted within 14 days of delivery.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
