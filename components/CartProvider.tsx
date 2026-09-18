"use client";

import React, { createContext, useContext, useSyncExternalStore } from "react";
import {
  addItem,
  itemCount,
  loadCart,
  removeItem,
  saveCart,
  setQuantity,
  CART_STORAGE_KEY,
  type CartItem,
} from "@/lib/cart";

/**
 * The Cart, held in localStorage and never bound to an account (ADR 0001).
 *
 * This is a thin wrapper and deliberately holds no money math: every quantity
 * rule and the subtotal live in lib/cart.ts, where they are tested (#32).
 *
 * localStorage is an external store, so it is read through
 * `useSyncExternalStore` rather than an effect. That is not a style preference.
 * The obvious shape -- load in one effect, save-on-change in another -- has a
 * bug in it: the save effect also runs on mount, with the empty initial state,
 * and writes `[]` over the shopper's stored Cart. The end state recovers a
 * moment later, so the damage is invisible in the final contents; what does not
 * recover is another tab, or a reload landing inside that window, reading the
 * empty Cart and keeping it. Here there is no save-on-change effect at all --
 * writes happen only when the shopper actually does something -- so the bug is
 * absent by construction rather than guarded against. There is a test in
 * CartProvider.test.tsx holding that line.
 *
 * Reading through an external store also buys cross-tab sync for free: the
 * `storage` event fires in every *other* tab, so two open tabs cannot drift.
 */

const EMPTY: CartItem[] = [];

// getSnapshot must return a stable reference while nothing has changed, or
// React re-renders forever. The raw string is the cache key.
let cachedRaw: string | null = null;
let cachedItems: CartItem[] = EMPTY;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  // Fired by other tabs, never by this one.
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getSnapshot(): CartItem[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CART_STORAGE_KEY);
  } catch {
    raw = null;
  }

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedItems = loadCart(window.localStorage);
  }
  return cachedItems;
}

/**
 * The server has no localStorage, so it renders an empty Cart. The browser
 * swaps in the real one after hydration -- which is why the nav badge waits on
 * `hydrated` rather than rendering a count the server could not have known.
 */
function getServerSnapshot(): CartItem[] {
  return EMPTY;
}

/**
 * Empty the Cart. Module-level rather than rebuilt per render, because
 * /checkout/success calls it from an effect (#19) and a fresh identity every
 * render would make that effect fire on every render.
 *
 * The only caller is a confirmed Order. Nothing else in the app is allowed to
 * empty a shopper's Cart wholesale.
 */
function clearCart(): void {
  write([]);
}

function write(next: CartItem[]): void {
  saveCart(window.localStorage, next);
  cachedRaw = JSON.stringify(next);
  cachedItems = next;
  notify();
}

type CartContextValue = {
  items: CartItem[];
  count: number;
  /** False until localStorage has been read. See the nav badge. */
  hydrated: boolean;
  add: (variantId: string, quantity?: number) => void;
  setItemQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  /** Empty the Cart. Only a confirmed Order does this (#19). */
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const value: CartContextValue = {
    items,
    count: itemCount(items),
    hydrated,
    add: (variantId, quantity = 1) => write(addItem(getSnapshot(), variantId, quantity)),
    setItemQuantity: (variantId, quantity) =>
      write(setQuantity(getSnapshot(), variantId, quantity)),
    remove: (variantId) => write(removeItem(getSnapshot(), variantId)),
    clear: clearCart,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside a CartProvider");
  return value;
}
