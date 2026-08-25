# Product and Hero Story images live in Supabase Storage, not `public/`

Every Product currently points at one committed placeholder, `/images/download.jpeg`, served from `public/`. That does not survive contact with a real catalog: ADR 0002 puts Product editing in the client's hands, and a non-technical client cannot commit an image to git — an image that only exists in the repository is an image only a developer can add. ADR 0005 independently flags that Cloudflare's free tier discourages serving a disproportionate share of images and large files, which is exactly what a growing catalog plus many Hero Stories would become. We chose to store Product and Hero Story images in a Supabase Storage bucket, with the row holding a URL, keeping media in the same system as the data that references it rather than introducing a third service. Cloudflare Images or R2 was considered and deferred: it is the natural destination if the free tier becomes a problem, and moving from Storage to R2 later changes a URL column, not a data model.

Brand assets that ship with the code — the logos in `public/images/` — stay in the repository. They are not client-editable content and belong with the code that references them.

## Consequences

Images now come from a different origin than the app, so Supabase's hostname must be allowed in the Next.js image configuration, and the bucket's own RLS policies become part of the ADR 0004 audit — a public-read bucket with unrestricted writes would be as much a hole as an open table. Storage counts against the Supabase free tier's quota, which is the ceiling to watch as the catalog grows.
