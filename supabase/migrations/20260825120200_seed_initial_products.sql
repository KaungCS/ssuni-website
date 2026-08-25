-- Seed the two existing Products and their six Variants from data/products.json,
-- so the catalog migration in #9 has something to read. Issue #4.
--
-- This ships as a migration rather than supabase/seed.sql because seed.sql runs
-- only on a local `db reset` -- `db push` against the linked remote skips it,
-- and the remote is where this data has to land.
--
-- Idempotent on slug (products) and on (product_id, color, size) (variants), so
-- re-running is safe. Taxonomy values are the slugs components/ShopDropdown.tsx
-- already links to; see lib/taxonomy.ts for the display labels.
--
-- image_url keeps the shared /images/download.jpeg placeholder until #11 moves
-- Product images to Supabase Storage (ADR 0009).

insert into public.products
  (slug, name, description, price, image_url, is_new, department, category, collections)
values
  (
    'rabbit-hole-hoodie',
    'The Hoodie',
    'Crafted from heavyweight French terry, this hoodie features a relaxed drop-shoulder fit perfect for soft days. Features our signature embroidered bunny logo on the cuff.',
    65.00,
    '/images/download.jpeg',
    true,
    'unisex',
    'hoodies',
    array['the-rabbit-hole']
  ),
  (
    'signature-canvas-tote',
    'Signature Canvas Tote',
    'A durable, everyday carry-all made from 100% organic cotton canvas. Features reinforced straps and an interior pocket.',
    28.00,
    '/images/download.jpeg',
    false,
    'unisex',
    'totes',
    array[]::text[]
  )
on conflict (slug) do update set
  name        = excluded.name,
  description = excluded.description,
  price       = excluded.price,
  image_url   = excluded.image_url,
  is_new      = excluded.is_new,
  department  = excluded.department,
  category    = excluded.category,
  collections = excluded.collections;

insert into public.variants (product_id, color, size, stock)
select p.id, v.color, v.size, v.stock
from (values
  ('rabbit-hole-hoodie',    'Espresso', 'S',  5),
  ('rabbit-hole-hoodie',    'Espresso', 'M', 12),
  ('rabbit-hole-hoodie',    'Espresso', 'L',  0),
  ('rabbit-hole-hoodie',    'Bone',     'M',  8),
  ('rabbit-hole-hoodie',    'Bone',     'L', 10),
  ('signature-canvas-tote', 'Natural',  'OS', 20)
) as v (product_slug, color, size, stock)
join public.products p on p.slug = v.product_slug
on conflict (product_id, color, size) do update set
  stock = excluded.stock;
