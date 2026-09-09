"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { addItem, itemCount, loadCart, removeItem, saveCart, setQuantity, type CartItem } from "@/lib/cart";

type CartContextValue = {
  items: CartItem[];
  count: number;
  hydrated: boolean;
  add: (variantId: string, quantity?: number) => void;
  setItemQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // localStorage does not exist while the server renders, so the Cart cannot be
  // read until the browser takes over. `hydrated` is what the nav badge waits
  // on (Q12): rendering a count the server could not have known is a hydration
  // mismatch, and mirroring the count into a cookie so the server *could* know
  // it would put the same truth in two stores, which drift.
  useEffect(() => {
    setItems(loadCart(window.localStorage));
    setHydrated(true);
  }, []);

  // Gated on `hydrated` on purpose, and there is a test holding this line.
  //
  // Without the guard this effect also runs on mount, with the empty initial
  // state, and writes `[]` over the shopper's stored Cart. The final contents
  // recover -- the load effect's state change re-fires this one a moment later
  // -- so the end state looks fine and the bug hides. What does not recover is
  // another tab, or a reload landing inside that window, reading the empty Cart
  // and keeping it. Issue #12 promises the Cart survives a reload; this is the
  // line that makes that true.
  useEffect(() => {
    if (!hydrated) return;
    saveCart(window.localStorage, items);
  }, [items, hydrated]);

  return (
    <CartContext.Provider
      value={{
        items,
        count: itemCount(items),
        hydrated,
        add: (variantId, quantity = 1) => setItems((current) => addItem(current, variantId, quantity)),
        setItemQuantity: (variantId, quantity) => setItems((current) => setQuantity(current, variantId, quantity)),
        remove: (variantId) => setItems((current) => removeItem(current, variantId)),
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside a CartProvider");
  return value;
}
