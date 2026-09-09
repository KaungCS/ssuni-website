/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY } from "@/lib/cart";
import { CartProvider, useCart } from "./CartProvider";

const HOODIE_ESPRESSO_M = "11111111-1111-4111-8111-111111111111";

function CartProbe() {
  const { count, hydrated } = useCart();
  return <span data-testid="probe">{hydrated ? `hydrated:${count}` : "pending"}</span>;
}

function renderCart() {
  return render(
    <CartProvider>
      <CartProbe />
    </CartProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("CartProvider hydration", () => {
  it("restores a Cart stored by a previous visit", () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([{ variantId: HOODIE_ESPRESSO_M, quantity: 2 }]),
    );

    renderCart();

    expect(screen.getByTestId("probe")).toHaveTextContent("hydrated:2");
  });

  it("never writes an empty Cart over a stored one while mounting", () => {
    // Asserting on the *final* contents of storage proves nothing: a
    // save-on-change effect that clobbers the stored Cart on mount is undone a
    // moment later, when the load effect's state change re-fires it. The
    // damage is the transient write itself -- another tab, or a reload landing
    // inside that window, reads the empty Cart and keeps it.
    //
    // So the invariant is about writes, not about the end state.
    const stored = JSON.stringify([{ variantId: HOODIE_ESPRESSO_M, quantity: 2 }]);
    window.localStorage.setItem(CART_STORAGE_KEY, stored);

    const writes: string[] = [];
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === CART_STORAGE_KEY) writes.push(value);
      });

    renderCart();
    setItem.mockRestore();

    expect(writes).not.toContain("[]");
  });
});
