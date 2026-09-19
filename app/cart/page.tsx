"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { money, reconcile, type ReconciledItem, type VariantAvailability } from "@/lib/cart";
import { createClient } from "@/lib/supabase/client";
import type { ResolvedVariant } from "@/lib/catalog";

/**
 * The Cart page.
 *
 * A client component, because the Cart lives in localStorage (ADR 0001). It
 * therefore cannot import lib/catalog.ts -- that module reaches next/headers --
 * so live prices and Available Stock arrive through POST /api/cart/resolve.
 *
 * Nothing here computes money. `reconcile` in lib/cart.ts decides what each
 * line costs and what the subtotal is, so /cart and checkout cannot come to
 * different answers. This file only renders what it is told.
 */

/**
 * Keyed by the ids it was fetched for, so "is this stale?" is derived rather
 * than tracked: changing the Cart makes the previous result stale on the spot,
 * with no effect having to set a loading flag.
 */
type ResolveState =
  | { key: string; status: "error" }
  | { key: string; status: "ready"; variants: Record<string, ResolvedVariant> };

/** Sign in, then come straight back to the Cart it was pressed from (#16). */
const LOGIN_HREF = `/login?next=${encodeURIComponent("/cart")}`;

/**
 * Ask the server what the Cart's Variants cost and how many are left.
 *
 * Outside the component on purpose: it takes the Cart's ids and returns the
 * next state rather than setting any, which keeps every state write in this
 * file inside an async callback.
 */
async function resolveCart(key: string): Promise<ResolveState> {
  try {
    const response = await fetch("/api/cart/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantIds: key.split(",") }),
    });
    if (!response.ok) throw new Error(`Resolve failed: ${response.status}`);

    const body: { variants: ResolvedVariant[] } = await response.json();
    return {
      key,
      status: "ready",
      variants: Object.fromEntries(body.variants.map((variant) => [variant.variantId, variant])),
    };
  } catch {
    return { key, status: "error" };
  }
}

export default function CartPage() {
  const router = useRouter();
  const { items, hydrated, setItemQuantity, remove } = useCart();
  const [resolved, setResolved] = useState<ResolveState | null>(null);
  // The Variant whose last quantity edit was clamped, so the snap-back can be
  // explained. Transient UI state, never persisted.
  const [clampedVariantId, setClampedVariantId] = useState<string | null>(null);
  // Checkout is a separate failure surface from resolve: the Cart is still
  // perfectly renderable when Stripe is unreachable, so this never replaces the
  // page the way the resolve error state does.
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  // null while unknown. Purely so the shopper can see the login step coming
  // (#16) instead of meeting it after a click -- POST /api/checkout verifies
  // the user server-side and 401s regardless of what this says.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    // getSession reads the stored token without a network round trip. That is
    // the right trade for a label: it is never the authority, and a token that
    // expired between this read and the click is caught by the 401 below.
    void createClient()
      .auth.getSession()
      .then(({ data }) => setSignedIn(data.session !== null));
  }, []);

  /**
   * Hand the Cart to POST /api/checkout and follow the Session it returns.
   *
   * Sends ids and quantities only. The route re-reads every price from Supabase
   * (ADR 0008) and would ignore a price sent from here, which is the point: a
   * browser must never be able to name what it is charged.
   */
  async function startCheckout() {
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();

      if (res.status === 401) {
        // Signed out, or signed out since the page loaded. `next` brings them
        // back here with the Cart intact -- it lives in localStorage, so the
        // round trip through /login cannot cost them anything.
        router.push(LOGIN_HREF);
        return;
      }
      if (!res.ok) {
        setCheckoutError(data.error ?? "Checkout is unavailable right now.");
        setCheckingOut(false);
        return;
      }
      // Leaving the origin for Stripe's hosted page (ADR 0008). `checkingOut`
      // is deliberately left true -- the navigation is in flight, and
      // re-enabling the button here would let a second click create a second
      // Session and a second hold on the same stock.
      window.location.href = data.url;
    } catch {
      setCheckoutError("Checkout is unavailable right now.");
      setCheckingOut(false);
    }
  }

  // Joined into a string so the effect below depends on the *ids*, not on a new
  // array identity every render.
  const variantIds = items.map((item) => item.variantId).join(",");

  useEffect(() => {
    if (!hydrated || variantIds === "") return;

    // Cancellation matters: without it a slow response for an older Cart can
    // land after a newer one and overwrite it. The `key` check below stops
    // stale data being *rendered*, but this stops it being stored at all.
    let cancelled = false;
    void resolveCart(variantIds).then((next) => {
      if (!cancelled) setResolved(next);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, variantIds]);

  const retry = () => {
    void resolveCart(variantIds).then(setResolved);
  };

  if (!hydrated) {
    return (
      <CartShell>
        <p className="font-belleza text-ssuni-slate">Loading your cart…</p>
      </CartShell>
    );
  }

  // Checked before the resolve state, so an empty Cart renders without waiting
  // on a request it never makes.
  if (items.length === 0) {
    return (
      <CartShell>
        <p className="font-belleza text-ssuni-slate mb-8">Your cart is empty.</p>
        <Link
          href="/catalog"
          className="border border-ssuni-brown px-8 py-3 text-xs uppercase tracking-widest font-belleza hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors"
        >
          Continue shopping
        </Link>
      </CartShell>
    );
  }

  // Loading is derived from the data being absent or belonging to a different
  // Cart, so nothing sets a flag synchronously inside an effect.
  if (resolved === null || resolved.key !== variantIds) {
    return (
      <CartShell>
        <p className="font-belleza text-ssuni-slate">Loading your cart…</p>
      </CartShell>
    );
  }

  if (resolved.status === "error") {
    return (
      <CartShell>
        <p className="font-belleza text-ssuni-slate mb-6">
          We couldn&apos;t load your cart just now. Your items are safe — please try again.
        </p>
        <button
          onClick={retry}
          className="border border-ssuni-brown px-8 py-3 text-xs uppercase tracking-widest font-belleza hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors cursor-pointer"
        >
          Retry
        </button>
      </CartShell>
    );
  }

  // The subtotal and every line total come from here, and only from here.
  const availability: Record<string, VariantAvailability> = Object.fromEntries(
    Object.values(resolved.variants).map((variant) => [
      variant.variantId,
      { price: variant.price, availableStock: variant.availableStock },
    ]),
  );
  const cart = reconcile(items, availability);

  return (
    <CartShell>
      <ul className="border-t border-ssuni-light2">
        {cart.items.map((line) => (
          <CartRow
            key={line.variantId}
            line={line}
            variant={resolved.variants[line.variantId]}
            wasClamped={clampedVariantId === line.variantId}
            onQuantityChange={(quantity) => {
              // Clamped at the point of the edit, exactly as adding is. This is
              // not the Cart mutating itself behind the shopper: they typed a
              // number, it snaps to what is buyable, and the reason appears
              // beside it. Stock dropping while the Cart sits untouched is the
              // other case, and that one only *shows* the shortfall -- it never
              // rewrites what was stored.
              const stock = resolved.variants[line.variantId]?.availableStock ?? quantity;
              setClampedVariantId(quantity > stock ? line.variantId : null);
              setItemQuantity(line.variantId, Math.min(quantity, stock));
            }}
            onRemove={() => remove(line.variantId)}
          />
        ))}
      </ul>

      <div className="mt-10 flex flex-col items-end gap-4">
        <div className="flex items-baseline gap-6">
          <span className="text-xs uppercase tracking-widest font-belleza text-ssuni-slate">
            Subtotal
          </span>
          <span className="font-cinzel text-2xl text-ssuni-brown">{money(cart.subtotal)}</span>
        </div>
        <p className="text-xs font-belleza text-ssuni-slate">
          Shipping and taxes are calculated at checkout.
        </p>
        {signedIn === false && (
          <p className="font-belleza text-sm text-ssuni-slate">
            An account is needed to place an order. Your Cart comes with you.
          </p>
        )}
        {/* The button starts the Session; the hold behind it is what actually
            decides whether the stock can be sold (ADR 0010). Everything above
            is UX, not a correctness gate -- including the signed-out label: it
            only saves a round trip, since the route 401s either way. */}
        <button
          onClick={
            signedIn === false
              ? () => router.push(LOGIN_HREF)
              : startCheckout
          }
          disabled={checkingOut || items.length === 0}
          className="border border-ssuni-brown px-10 py-4 text-xs uppercase tracking-widest font-belleza transition-colors hover:bg-ssuni-brown hover:text-ssuni-light1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ssuni-brown cursor-pointer"
        >
          {checkingOut
            ? "Taking you to checkout…"
            : signedIn === false
              ? "Sign in to check out"
              : "Checkout"}
        </button>
        {checkoutError && (
          <p className="font-belleza text-sm text-ssuni-brown">{checkoutError}</p>
        )}
      </div>
    </CartShell>
  );
}

function CartShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pt-32 pb-24">
      <div className="max-w-4xl mx-auto px-6 text-ssuni-brown">
        <h1 className="font-cinzel text-4xl mb-10">Your Cart</h1>
        {children}
      </div>
    </div>
  );
}

function CartRow({
  line,
  variant,
  wasClamped,
  onQuantityChange,
  onRemove,
}: {
  line: ReconciledItem;
  variant: ResolvedVariant | undefined;
  /** The shopper just asked for more of this Variant than is buyable. */
  wasClamped: boolean;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  const unavailable = line.status === "unavailable";

  return (
    <li className="flex gap-4 sm:gap-6 py-8 border-b border-ssuni-light2">
      {/* `relative` is required by next/image's fill mode, which positions the
          image absolutely against its nearest positioned ancestor. */}
      <div className="relative w-24 h-32 bg-ssuni-light2 shrink-0 overflow-hidden">
        {variant ? (
          <Image
            src={variant.imageUrl ?? "/images/download.jpeg"}
            alt={variant.productName}
            fill
            sizes="96px"
            className={`object-cover ${unavailable ? "opacity-40" : ""}`}
          />
        ) : null}
      </div>

      {/* min-w-0 is load-bearing: without it a flex child will not shrink below
          its content width, and the price column gets pushed past the page
          padding on narrow screens. */}
      <div className="flex-grow min-w-0 flex flex-col">
        {variant ? (
          <Link
            href={`/catalog/${variant.productSlug}`}
            className="font-cinzel text-xl hover:opacity-70 transition-opacity break-words"
          >
            {variant.productName}
          </Link>
        ) : (
          <span className="font-cinzel text-xl text-ssuni-slate">
            This piece is no longer available
          </span>
        )}

        {variant && (
          <p className="font-belleza text-sm text-ssuni-slate mt-1">
            {variant.color} · {variant.size}
          </p>
        )}

        {/* The Cart never silently corrects itself: a shortfall is shown, and an
            unavailable line stays visible and out of the subtotal rather than
            being deleted behind the shopper. */}
        {/* Two different shortfalls. `short` is stock having dropped while the
            Cart sat untouched -- shown, never written back. `wasClamped` is the
            shopper having just typed a bigger number than exists. */}
        {line.status === "short" && (
          <p className="font-belleza text-sm text-ssuni-brown mt-2">
            Only {line.quantity} left — reduced from {line.requestedQuantity}.
          </p>
        )}
        {line.status !== "short" && wasClamped && (
          <p className="font-belleza text-sm text-ssuni-brown mt-2">
            Only {line.quantity} left — that is the most we can send you.
          </p>
        )}
        {unavailable && (
          <p className="font-belleza text-sm text-ssuni-brown mt-2">
            Sold out or no longer stocked. It will not be included at checkout.
          </p>
        )}

        <div className="mt-auto pt-4 flex items-center gap-6">
          {!unavailable && (
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest font-belleza text-ssuni-slate">
              Qty
              <input
                type="number"
                min={1}
                max={variant?.availableStock ?? 1}
                value={line.quantity}
                onChange={(event) => onQuantityChange(Number(event.target.value))}
                className="w-16 border border-ssuni-light2 px-2 py-1 font-belleza text-ssuni-brown"
              />
            </label>
          )}
          <button
            onClick={onRemove}
            className="text-xs uppercase tracking-widest font-belleza text-ssuni-slate hover:text-ssuni-brown transition-colors cursor-pointer"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="text-right font-belleza shrink-0">
        {unavailable ? (
          <span className="text-ssuni-slate">—</span>
        ) : (
          <span className="text-ssuni-brown">{money(line.lineTotal)}</span>
        )}
      </div>
    </li>
  );
}
