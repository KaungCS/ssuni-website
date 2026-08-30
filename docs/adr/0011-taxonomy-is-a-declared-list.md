# Taxonomy terms are a declared list, enforced first by CHECK and then by tables

Department, Category, and Collection were `text` and `text[]` columns whose vocabulary lived only in `lib/taxonomy.ts` — a TypeScript file the database has never heard of. That was harmless while nothing read the values. Issue #10 made it harmful: the catalog now `notFound()`s on a slug it does not recognise, so a Product carrying an undeclared category renders nowhere and raises no error anywhere. The client edits Products by hand in Supabase Studio until the Admin Dashboard ships (ADR 0007), which makes `hoodiez` for `hoodies` an ordinary Tuesday rather than an edge case, and silent invisibility the worst failure mode on offer.

The decision underneath the enforcement is a model one: **a Product picks a taxonomy term from a declared list and can never mint a new one.** The Admin Dashboard will give the client a page to edit that list, and the Product editor will only ever offer terms already on it. The category editor is therefore a prerequisite of the Product editor, not an afterthought.

We chose to stage the enforcement. **Now:** `CHECK` constraints on `products.department`, `products.category`, and `products.collections`, generated from the lists in `lib/taxonomy.ts`, so an invented term fails loudly at the database instead of producing an invisible Product. **Next (issue #38):** real `departments` / `categories` / `collections` tables with foreign keys, which is the shape the Admin Dashboard needs to edit.

Going straight to tables was the tempting option and was rejected on timing, not on merit. It is a schema change plus RLS policies plus `lib/catalog.ts` changes plus `db:verify` extensions — a session of its own, in a week already carrying the catalog filters it was discovered by. Leaving enforcement to convention until October was rejected outright: the storefront's 404 behaviour was shipping today, and the gap between "the code knows these seven categories" and "the database accepts any string" is precisely where a client's typo becomes an invisible Product.

## Consequences

Adding a category now requires a migration, so the client cannot do it alone. That is a genuine regression in their autonomy, accepted because they could not do it alone before either — `lib/taxonomy.ts` is equally out of reach — and because it lasts one session. The constraint lists and `lib/taxonomy.ts` must be edited together until #38 removes the duplication; both files say so.

The migration to tables is data-preserving: existing slugs become rows, the `CHECK` constraints are dropped, and foreign keys replace them. `collections` being `text[]` does not have a natural foreign key, so #38 must choose between a join table and a trigger-checked constraint and record which.

Because the storefront and the database now enforce the same list from two places, a term added to one and not the other fails in opposite directions — added only to `lib/taxonomy.ts`, the catalog offers a filter no Product can hold; added only to the constraint, a valid Product 404s. Neither is silent, which is the improvement, but both are confusing until #38 collapses them into one source.
