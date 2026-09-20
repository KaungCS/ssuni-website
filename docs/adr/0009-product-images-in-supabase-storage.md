# Product and Hero Story images live in Supabase Storage, not `public/`

Every Product currently points at one committed placeholder, `/images/download.jpeg`, served from `public/`. That does not survive contact with a real catalog: ADR 0002 puts Product editing in the client's hands, and a non-technical client cannot commit an image to git — an image that only exists in the repository is an image only a developer can add. ADR 0005 independently flags that Cloudflare's free tier discourages serving a disproportionate share of images and large files, which is exactly what a growing catalog plus many Hero Stories would become. We chose to store Product and Hero Story images in a Supabase Storage bucket, with the row holding a URL, keeping media in the same system as the data that references it rather than introducing a third service. Cloudflare Images or R2 was considered and deferred: it is the natural destination if the free tier becomes a problem, and moving from Storage to R2 later changes a URL column, not a data model.

Brand assets that ship with the code — the logos in `public/images/` — stay in the repository. They are not client-editable content and belong with the code that references them.

## Consequences

Images now come from a different origin than the app, so Supabase's hostname must be allowed in the Next.js image configuration, and the bucket's own RLS policies become part of the ADR 0004 audit — a public-read bucket with unrestricted writes would be as much a hole as an open table. Storage counts against the Supabase free tier's quota, which is the ceiling to watch as the catalog grows.

## Amendment, 2026-09-19: a Product has an ordered gallery, not one image

This ADR says "the row holding a URL", singular, and `products.image_url` implemented it literally. That was never right for a clothing catalogue — `components/ProductDetail.tsx` has carried a `{/* Left Column: Product Image Gallery */}` comment above a single `<img>` since the storefront was static — and it was spotted only because the deferral in [ADR 0007](./0007-admin-dashboard-deferred.md) was being lifted. A shop that cannot show a garment from more than one angle is not a shop the client can photograph for.

Images move to a `product_images` table — `(product_id, url, sort_order, color)` — and `products.image_url` is dropped rather than kept alongside it. Keeping both would leave two answers to "what is the main image", which is the kind of question that gets answered differently in the catalogue grid and the Stripe line item. `sort_order = 0` is the card image, and `CatalogProduct.imageUrl` becomes a derived first-image so that `ProductGrid`, `/cart`, the Open Graph tag and `toStripeLineItems` are unchanged by this. Only the detail page grows a gallery.

**`color` ships nullable and deliberately unwired.** `variants.color` is already the variant axis, so a shopper selecting Sage and seeing a brown photograph is a real defect rather than a missing nicety — but it is a defect in the *interface*, not the data. The column costs one word in the migration and is the difference between one migration and two; writing the component code for it now would be speculative. When it is wired, it is a change to `ProductDetail.tsx` and nothing else.

## Consequences of the amendment

Storage usage per Product multiplies by however many angles the client shoots, against a free-tier quota that [ADR 0012](./0012-supabase-free-tier-through-launch.md) commits us to through launch. That ceiling was already the one to watch and is now nearer; Cloudflare R2 remains the documented destination, and it remains a URL column rather than a data model.

The bucket also acquires a second writer. It was scoped here as admin-only, which a human uploading through Supabase Studio satisfied trivially; the Admin Dashboard now uploads from a browser, so the bucket's own policies — not the UI — are what stop a signed-in customer writing to it. That belongs in the [#24](https://github.com/KaungCS/ssuni-website/issues/24) audit as a positive and negative test, not as a reading of the policy text.
