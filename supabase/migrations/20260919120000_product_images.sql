-- Product images: an ordered gallery per Product, in Supabase Storage.
--
-- Issue #11, per ADR 0009 as amended 2026-09-19.
--
-- ADR 0009 originally said "the row holding a URL", singular, and
-- products.image_url implemented that literally. It was never right for a
-- clothing catalogue, and the code has been saying so since the storefront was
-- static: components/ProductDetail.tsx carries a
-- "{/* Left Column: Product Image Gallery */}" comment above a single <img>.
--
-- This migration does three things, in order, and the order matters:
--   1. creates public.product_images with its RLS and grants,
--   2. creates the Storage bucket the Admin Dashboard uploads into,
--   3. copies every existing products.image_url across, then DROPS that column.
--
-- Step 3 drops rather than keeps. Two columns answering "what is the main
-- image" is how the catalogue grid and the Stripe line item come to disagree
-- about what the shopper was looking at when they paid.

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------

create table if not exists public.product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- Either a Storage public URL or a path under public/ ('/images/download.jpeg').
  -- Both are just a src to the component, which is what lets the seeded
  -- placeholders survive this migration instead of blocking it on #5.
  url        text not null,
  -- Ascending; sort_order 0 is the card image and the Open Graph image.
  --
  -- Deliberately NOT unique on (product_id, sort_order), matching
  -- hero_stories.sort_order. A unique constraint turns "swap two images" into a
  -- three-statement dance around a temporary value for no benefit -- ties break
  -- on created_at below, so the order is total and stable regardless.
  sort_order integer not null default 0,
  -- Which Variant colour this image shows, or null for "any".
  --
  -- Ships nullable and DELIBERATELY UNWIRED (ADR 0009, amended). variants.color
  -- is already the variant axis, so a shopper picking Sage and seeing a brown
  -- photograph is a real defect -- but it is a defect in the interface, not in
  -- the data. This column is one word here and is the difference between one
  -- migration and two; wiring it is a change to ProductDetail.tsx and nothing
  -- else. Do not add a foreign key to variants: an image belongs to a colour,
  -- not to a (colour, size) pair, and there is no table of colours to point at.
  color      text,
  created_at timestamptz not null default now()
);

comment on table public.product_images is
  'Ordered gallery for a Product (#11, ADR 0009 amended). sort_order 0 is the card image. The color column is reserved for colour-aware galleries and is currently unwired.';

-- Matches the only query: a Product''s images in display order.
create index if not exists product_images_product_order_idx
  on public.product_images (product_id, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- RLS. Part of this migration, not a follow-up hardening task (ADR 0004).
-- ---------------------------------------------------------------------------

alter table public.product_images enable row level security;

-- Visible exactly when the parent Product is -- the same shape as
-- variants_select_visible. The subquery is itself subject to
-- products_select_visible, so a Hidden Product's images disappear for shoppers
-- and stay visible to the admin without this policy naming is_hidden at all.
-- Getting this wrong leaks the photography for an unreleased drop.
drop policy if exists product_images_select_visible on public.product_images;
create policy product_images_select_visible on public.product_images
  for select to anon, authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_images.product_id
  ));

drop policy if exists product_images_admin_write on public.product_images;
create policy product_images_admin_write on public.product_images
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- Necessary in addition to the policies: Supabase does not auto-expose new
-- tables to the Data API roles, so RLS alone leaves this "permission denied".
grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;

-- ---------------------------------------------------------------------------
-- The Storage bucket (ADR 0009).
-- ---------------------------------------------------------------------------
--
-- Public read, so the storefront needs no signed URLs and no round trip to mint
-- them -- a product photo is not a secret. Writes are admin-only, and that is
-- now load-bearing in a way it was not when ADR 0009 was written: the bucket's
-- only writer was a human in Supabase Studio, and as of ADR 0007 (amended) it is
-- a browser. These policies, not the Admin Dashboard's UI, are what stop a
-- signed-in customer uploading.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists product_images_storage_read on storage.objects;
create policy product_images_storage_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists product_images_storage_admin_write on storage.objects;
create policy product_images_storage_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'product-images' and private.is_admin())
  with check (bucket_id = 'product-images' and private.is_admin());

-- ---------------------------------------------------------------------------
-- Migrate the existing single image across, then drop the column.
-- ---------------------------------------------------------------------------
--
-- Guarded on product_images being empty for that Product rather than upserted:
-- replaying this migration after the client has curated a real gallery must not
-- reinsert the placeholder at sort_order 0 and demote their chosen card image.
-- Same reasoning as the hero_stories seed guard in 20260918140000.

insert into public.product_images (product_id, url, sort_order)
select p.id, p.image_url, 0
from public.products p
where p.image_url is not null
  and not exists (
    select 1 from public.product_images pi where pi.product_id = p.id
  );

alter table public.products drop column if exists image_url;
