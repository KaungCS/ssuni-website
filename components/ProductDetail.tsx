"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog";
import { useCart } from "./CartProvider";

/**
 * Shown when a Product has no images at all. Not a defensive nicety: the
 * catalog is still placeholder data (#5), and a Product the client creates in
 * the Admin Dashboard exists before its photography does.
 */
const PLACEHOLDER_IMAGE = "/images/download.jpeg";

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
 * Adding clamps to Available Stock, which is a convenience and not a gate: the
 * number is a snapshot from page load, /cart re-checks it on every visit, and
 * the atomic check-and-hold in #15 is the only real authority on whether stock
 * can be sold (ADR 0010).
 */
export default function ProductDetail({ product }: { product: CatalogProduct }) {
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [addedVariantId, setAddedVariantId] = useState<string | null>(null);
  // Which gallery image is showing. Independent of the colour selection below:
  // ProductImage.color exists but is deliberately unwired (ADR 0009, amended).
  const [imageIndex, setImageIndex] = useState(0);
  const { add, items } = useCart();

  // Indexed rather than stored so an out-of-range index can never render a
  // blank panel -- `images` comes from the server and can be empty.
  const shownImage = product.images[imageIndex]?.url ?? PLACEHOLDER_IMAGE;

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

  // Derived, not stored: the confirmation belongs to one selection, so it
  // disappears when the shopper picks a different colour or size without any
  // effect having to reset it.
  const justAdded = addedVariantId !== null && addedVariantId === selectedVariant?.id;

  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-20">

        {/* Left Column: Product Image Gallery */}
        <div className="flex flex-col gap-4">
          <div className="w-full aspect-[3/4] bg-ssuni-light2 relative overflow-hidden">
            <Image
              src={shownImage}
              alt={product.name}
              fill
              // Half the grid from md up, full width below it.
              sizes="(min-width: 768px) 50vw, 100vw"
              priority
              className="object-cover"
            />
            {/* Added a Sage accent tag for 'New' items */}
            {product.isNew && (
              <span className="absolute top-4 left-4 bg-ssuni-sage text-white px-4 py-1.5 text-xs font-belleza tracking-widest uppercase shadow-sm">
                New Arrival
              </span>
            )}
          </div>

          {/* One image needs no picker, and no image needs no strip either. */}
          {product.images.length > 1 && (
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {product.images.map((image, i) => (
                <li key={`${image.url}-${i}`} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setImageIndex(i)}
                    aria-label={`Show image ${i + 1} of ${product.images.length}`}
                    aria-current={i === imageIndex}
                    className={`relative block w-20 aspect-[3/4] overflow-hidden bg-ssuni-light2 cursor-pointer transition-opacity ${
                      i === imageIndex
                        ? "ring-2 ring-ssuni-brown ring-offset-2 ring-offset-ssuni-light1"
                        : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    <Image
                      src={image.url}
                      alt=""
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
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
            onClick={() => {
              if (!selectedVariant) return;

              // Clamp at add-time so the Cart cannot be built past what is
              // sellable. /cart re-checks against fresh Available Stock, and
              // #15 holds the stock for real -- this only spares the shopper a
              // quantity that was never going to survive either.
              const alreadyInCart =
                items.find((item) => item.variantId === selectedVariant.id)?.quantity ?? 0;
              if (alreadyInCart >= selectedVariant.availableStock) return;

              add(selectedVariant.id, 1);
              setAddedVariantId(selectedVariant.id);
            }}
            disabled={!selectedColor || !selectedSize || selectedVariant?.availableStock === 0}
            className="w-full bg-ssuni-brown text-ssuni-light1 py-4 font-belleza uppercase tracking-widest text-sm hover:bg-ssuni-slate transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ssuni-brown cursor-pointer"
          >
            {selectedVariant?.availableStock === 0 ? "Out of Stock" : "Add to Cart"}
          </button>

          {justAdded && (
            <p className="mt-4 font-belleza text-sm text-ssuni-slate text-center">
              Added to your cart.{" "}
              <Link href="/cart" className="text-ssuni-brown underline hover:opacity-70">
                View cart
              </Link>
            </p>
          )}

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
