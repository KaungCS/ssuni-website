import { describe, expect, it, vi } from "vitest";

/**
 * `reorderIds` — the one piece of the Hero Story admin that is logic rather
 * than a form over a column. Issue #78, per ADR 0003 (amended twice).
 *
 * Written before the implementation, which #75 asks for specifically: every
 * other part of step 4 is a field the client can see is wrong on the page,
 * while an off-by-one at either end of this list silently shuffles the shop's
 * landing page. CLAUDE.md scopes *required* TDD to the money paths and this is
 * not one, so the rest of this file is written after its subject.
 *
 * Pure: array in, array out, no mocks. The module around it reaches
 * next/headers through lib/supabase/server.ts, so that is mocked to nothing —
 * the same trick lib/admin-catalog.test.ts and lib/admin.test.ts use, and for
 * the same reason: no test in this describe block touches a query.
 *
 * `toIndex` is 0-based here. The dashboard's Position box is 1-based, because
 * "type 1 to make it first" is what a non-technical client means; the actions
 * layer does that subtraction, so this function never sees it.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const { reorderIds } = await import("./admin-hero");

describe("reorderIds", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an id to the front", () => {
    expect(reorderIds(ids, "c", 0)).toEqual(["c", "a", "b", "d"]);
  });

  it("moves an id to the back", () => {
    expect(reorderIds(ids, "b", 3)).toEqual(["a", "c", "d", "b"]);
  });

  it("moves an id one place up", () => {
    // What the ↑ arrow is: "move to my position minus one".
    expect(reorderIds(ids, "c", 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves an id one place down", () => {
    // The ↓ arrow. The subtlety is that removing the id first shifts everything
    // after it left, so a naive splice-at-index+1 lands two places away.
    expect(reorderIds(ids, "b", 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("leaves the list alone when an id is moved to where it already is", () => {
    expect(reorderIds(ids, "b", 1)).toEqual(ids);
  });

  it("clamps a position past the end of the list", () => {
    // The Position box is a number input the client can type anything into.
    expect(reorderIds(ids, "a", 99)).toEqual(["b", "c", "d", "a"]);
  });

  it("clamps a negative position", () => {
    expect(reorderIds(ids, "d", -5)).toEqual(["d", "a", "b", "c"]);
  });

  it("returns the list unchanged for an id that is not in it", () => {
    // A stale page submitting a Story someone else deleted. Reordering around
    // a row that is gone must not renumber the survivors.
    expect(reorderIds(ids, "gone", 0)).toEqual(ids);
  });

  it("handles a single-element list", () => {
    expect(reorderIds(["only"], "only", 0)).toEqual(["only"]);
    expect(reorderIds(["only"], "only", 7)).toEqual(["only"]);
  });

  it("handles an empty list", () => {
    expect(reorderIds([], "a", 0)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const original = [...ids];
    reorderIds(ids, "a", 3);
    expect(ids).toEqual(original);
  });
});
