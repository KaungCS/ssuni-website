import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The first test harness in this repo, added with the Cart (#12).
 *
 * Deliberately minimal: `node` by default. Issue #32 scopes TDD to the logic
 * that can lose money -- Cart totals and quantity math, the reservation hold
 * (#15), and Stripe webhook idempotency (#18, #30) -- and explicitly exempts
 * presentational components, so `/cart` and the nav badge have no render tests
 * on purpose. jsdom is opted into by exactly one file rather than switched on
 * globally, so the exemption stays hard to erode by accident.
 *
 * `lib/cart.ts` is pure by design (ADR 0001, amended 2026-09-08): it takes
 * availability as a plain argument and imports nothing, so the money math runs
 * without a browser, a database, or a network.
 */
export default defineConfig({
  test: {
    environment: "node",
    // Default environment is node. The one test that needs a DOM -- the Cart
    // provider's hydration order, where a save effect can overwrite a stored
    // Cart before the load effect lands -- opts in per-file with a
    // `@vitest-environment jsdom` docblock, so nothing else pays for jsdom.
    // Route handlers are included too: the webhook's status codes are Stripe's
    // retry protocol (#18, #30), which #32 names as TDD-required and which no
    // pure seam can reach. Without `app/**` a test file there is silently never
    // collected -- it passes by not running.
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx", "app/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
