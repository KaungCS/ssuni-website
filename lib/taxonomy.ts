/**
 * The catalog taxonomy vocabulary, in one place.
 *
 * Products store slugs in their `department`, `category` and `collections`
 * columns; these are the display labels. The slugs are exactly what
 * components/ShopDropdown.tsx already emits as query params, so #10 can filter
 * on `searchParams` without translating anything.
 *
 * Adding a value here is the first half of adding it to the nav -- keep the two
 * in step, and until the Admin Dashboard ships (ADR 0007) the client picks from
 * this list by hand in Supabase Studio.
 */

export const DEPARTMENTS = {
  women: "Women",
  men: "Men",
  unisex: "Unisex Essentials",
} as const;

export const CATEGORIES = {
  tees: "Tops & Baby Tees",
  knitwear: "Knitwear & Sweaters",
  hoodies: "Hoodies & Sweats",
  bottoms: "Pants & Loungewear",
  totes: "Canvas Tote Bags",
  headwear: "Caps & Beanies",
  collectibles: "Mascot Stickers & Keychains",
} as const;

/**
 * Collections are curated by hand (CONTEXT.md): membership is chosen, never
 * computed from sales or recency. "Best Sellers" and "Fall Lookbook" are
 * merchandising shelves here rather than rankings, which is why the nav's
 * `?filter=best-sellers` and `?filter=lookbook` links become `?collection=`
 * links in #10.
 */
export const COLLECTIONS = {
  "the-rabbit-hole": "The Rabbit Hole",
  "best-sellers": "Best Sellers",
  "fall-lookbook": "Fall Lookbook",
} as const;

export type DepartmentSlug = keyof typeof DEPARTMENTS;
export type CategorySlug = keyof typeof CATEGORIES;
export type CollectionSlug = keyof typeof COLLECTIONS;

/** Display label for a slug, falling back to the raw value for unknown ones. */
export function departmentLabel(slug: string | null | undefined): string {
  return DEPARTMENTS[slug as DepartmentSlug] ?? slug ?? "";
}

export function categoryLabel(slug: string | null | undefined): string {
  return CATEGORIES[slug as CategorySlug] ?? slug ?? "";
}

export function collectionLabel(slug: string | null | undefined): string {
  return COLLECTIONS[slug as CollectionSlug] ?? slug ?? "";
}

/**
 * The declared vocabulary, as arrays. These are the single source of truth for
 * what the database will accept -- the CHECK constraints in
 * supabase/migrations/20260830120000_taxonomy_declared_values.sql are generated
 * from exactly these lists, so the two must be changed together until the real
 * taxonomy tables land (issue #38, ADR 0011).
 */
export const DEPARTMENT_SLUGS = Object.keys(DEPARTMENTS) as DepartmentSlug[];
export const CATEGORY_SLUGS = Object.keys(CATEGORIES) as CategorySlug[];
export const COLLECTION_SLUGS = Object.keys(COLLECTIONS) as CollectionSlug[];

export function isDepartmentSlug(value: string): value is DepartmentSlug {
  return value in DEPARTMENTS;
}

export function isCategorySlug(value: string): value is CategorySlug {
  return value in CATEGORIES;
}

export function isCollectionSlug(value: string): value is CollectionSlug {
  return value in COLLECTIONS;
}
