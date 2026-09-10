import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  parseCatalogFilters,
  parseCatalogSort,
  type CatalogVocabulary,
} from "./catalog-url";

/**
 * What a catalog URL means, tested without a database or a browser.
 *
 * Every test here hands the parser its own vocabulary. That is the whole point
 * of #50: the declared Taxonomy Terms are about to live in Postgres (#49), and
 * a parser that reached for them itself would have to become async and drag
 * `next/headers` into a module the filter drawer imports from the browser.
 * Taking them as an argument keeps the rules testable at this speed -- the same
 * trade lib/cart.ts makes with Available Stock.
 *
 * Note the vocabularies below are deliberately NOT the real storefront ones.
 * A test asserting that "hoodies" is a Category would start failing the day the
 * client renames a Term in Supabase Studio, which is a fact about the shop and
 * not about this parser.
 */
const VOCABULARY: CatalogVocabulary = {
  departments: ["alpha", "beta"],
  categories: ["one", "two"],
  collections: ["first", "second"],
};

describe("parseCatalogFilters", () => {
  it("keeps a Term the caller's vocabulary declares", () => {
    expect(parseCatalogFilters({ category: "one" }, VOCABULARY)).toEqual({
      departments: [],
      categories: ["one"],
      collections: [],
      isNew: false,
    });
  });

  it("reads the vocabulary it is given, not a vocabulary of its own", () => {
    // The same URL, judged against two different lists. This is the assertion
    // that would fail if the parser ever went back to consulting a constant:
    // one of these two calls has to be wrong.
    const known = parseCatalogFilters({ category: "seasonal" }, VOCABULARY);
    const declared = parseCatalogFilters(
      { category: "seasonal" },
      { ...VOCABULARY, categories: ["seasonal"] },
    );

    expect(known).toBeNull();
    expect(declared?.categories).toEqual(["seasonal"]);
  });

  // The rules below predate #50 and must survive #49 unchanged. They are here
  // because the vocabulary argument is what finally made them cheap to state.

  it("drops one undeclared value but keeps the dimension, when another value is real", () => {
    // ?category=one&category=nope still describes something, so the shopper
    // gets what they asked for rather than a 404.
    const filters = parseCatalogFilters({ category: ["one", "nope"] }, VOCABULARY);

    expect(filters?.categories).toEqual(["one"]);
  });

  it("signals 404 when every value in a dimension is undeclared", () => {
    // Rendering the full catalog here would silently ignore the request, and an
    // empty state would imply the Term is real and temporarily bare.
    expect(parseCatalogFilters({ department: "nope" }, VOCABULARY)).toBeNull();
    expect(parseCatalogFilters({ category: ["no", "also-no"] }, VOCABULARY)).toBeNull();
    expect(parseCatalogFilters({ collection: "nope" }, VOCABULARY)).toBeNull();
  });

  it("combines dimensions with AND and values within a dimension with OR", () => {
    const filters = parseCatalogFilters(
      { department: "alpha", category: ["one", "two"] },
      VOCABULARY,
    );

    expect(filters).toEqual({
      departments: ["alpha"],
      categories: ["one", "two"],
      collections: [],
      isNew: false,
    });
  });

  it("collapses a Term repeated in the URL, so it is not asked for twice", () => {
    const filters = parseCatalogFilters({ category: ["one", "one"] }, VOCABULARY);

    expect(filters?.categories).toEqual(["one"]);
  });

  it("ignores an empty value rather than treating it as a Term", () => {
    expect(parseCatalogFilters({ category: "" }, VOCABULARY)).toEqual({
      departments: [],
      categories: [],
      collections: [],
      isNew: false,
    });
  });

  it("treats New Arrivals as its own dimension, not a Collection", () => {
    expect(parseCatalogFilters({ new: "true" }, VOCABULARY)?.isNew).toBe(true);
    expect(parseCatalogFilters({ new: "1" }, VOCABULARY)?.isNew).toBe(true);
    expect(parseCatalogFilters({}, VOCABULARY)?.isNew).toBe(false);
  });

  it("signals 404 for a New Arrivals value that means nothing", () => {
    // ?new=maybe is as meaningless as an undeclared slug, and misleads in the
    // same way if quietly ignored.
    expect(parseCatalogFilters({ new: "maybe" }, VOCABULARY)).toBeNull();
    expect(parseCatalogFilters({ new: "false" }, VOCABULARY)).toBeNull();
  });

  it("does not mistake an inherited object property for a declared Term", () => {
    // Not a hypothetical, and not preserved behaviour: before #50 the
    // vocabulary was an object and membership was tested with `in`, which walks
    // the prototype chain. `?category=constructor` therefore validated, and the
    // shopper got an empty catalog instead of a 404. Matching against a list
    // closed that by accident; this pins it shut on purpose.
    expect(parseCatalogFilters({ category: "constructor" }, VOCABULARY)).toBeNull();
    expect(parseCatalogFilters({ department: "toString" }, VOCABULARY)).toBeNull();
    expect(parseCatalogFilters({ collection: "hasOwnProperty" }, VOCABULARY)).toBeNull();
  });

  it("accepts a vocabulary with an empty dimension, and declares nothing real in it", () => {
    // #49 makes this reachable: a client can delete their last Collection.
    // A URL naming one then 404s, which is correct -- but a bare catalog must
    // still render.
    const empty: CatalogVocabulary = { departments: [], categories: [], collections: [] };

    expect(parseCatalogFilters({}, empty)).toEqual(NO_FILTERS);
    expect(parseCatalogFilters({ collection: "first" }, empty)).toBeNull();
  });
});

describe("parseCatalogSort", () => {
  it("defaults to Newest when no sort is asked for", () => {
    expect(parseCatalogSort({})).toBe("newest");
  });

  it("reads a sort the menu offers", () => {
    expect(parseCatalogSort({ sort: "price-asc" })).toBe("price-asc");
    expect(parseCatalogSort({ sort: "price-desc" })).toBe("price-desc");
  });

  it("falls back rather than signalling 404 on a sort it does not know", () => {
    // Deliberately unlike a filter: a bad sort still shows the right Products,
    // so nobody is misled by ?sort=cheapest rendering in Newest order.
    expect(parseCatalogSort({ sort: "cheapest" })).toBe("newest");
  });
});
