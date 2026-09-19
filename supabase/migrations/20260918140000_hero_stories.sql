-- Hero Stories: the landing page's editorial sections, as rows. Issue #22, per
-- ADR 0003 (amended 2026-09-18) and ADR 0004 (RLS is the security boundary).
--
-- Terminology follows CONTEXT.md: a Hero Story is one full-bleed story panel on
-- the landing page; Hidden is the state that excludes it from customer-facing
-- pages without deleting the record.
--
-- NOTE FOR ANYONE READING ADR 0003 FIRST: the original decision was a FIXED
-- number of Hero Slots (one primary banner plus a few secondary tiles) that the
-- client assigned Stories into. That is not this table. The amendment replaces
-- Slots with an unbounded, explicitly ordered list that stacks vertically -- so
-- there is no `slot` column, and adding a row is how you add a section to the
-- home page. See the amendment for why.

create table if not exists public.hero_stories (
  id          uuid primary key default gen_random_uuid(),
  -- The small uppercase line above the headline ("SSUNI Fall 2026 Collection").
  -- Nullable: a Story is allowed to be just a headline over an image.
  eyebrow     text,
  title       text not null,
  subtitle    text,
  -- Not null, because a Hero Story with no image is a blank full-screen panel
  -- rather than a degraded one. Until #11 there is nowhere to upload to, so this
  -- holds a path under public/ ('/images/download.jpeg'); afterwards it holds a
  -- Supabase Storage public URL. Both are just a src to the component, which is
  -- why #22 does not have to wait on #11.
  image_url   text not null,
  -- The call to action. Both or neither: the component renders no button unless
  -- it has a label AND a destination, so a half-filled row degrades to a Story
  -- with no button instead of an empty link.
  cta_label   text,
  cta_href    text,
  -- "Hidden" per CONTEXT.md, and deliberately the same polarity and name as
  -- products.is_hidden: the client edits both tables in the same Supabase Studio
  -- until the Admin Dashboard ships (ADR 0007), and one table meaning "tick to
  -- show" while the other means "tick to hide" is how a Product gets hidden by
  -- accident.
  is_hidden   boolean not null default false,
  -- Ascending. Ties break on created_at so the order is total and stable even
  -- when the client leaves several rows at the default -- without that, two rows
  -- sharing a sort_order swap places between requests for no visible reason.
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Matches the storefront's only query: visible Stories, in display order.
create index if not exists hero_stories_visible_order_idx
  on public.hero_stories (sort_order, created_at)
  where not is_hidden;

-- ---------------------------------------------------------------------------
-- Seed: the hero that was hardcoded in components/HeroStory.tsx until now.
-- ---------------------------------------------------------------------------
--
-- Guarded on the table being empty rather than upserted on a key. There is no
-- natural key to conflict on, and more importantly an upsert would resurrect
-- this Story every time the migration is replayed -- including after the client
-- has deliberately deleted it. Empty-table is the only condition under which
-- re-inserting it is certainly not undoing someone's work.

insert into public.hero_stories (eyebrow, title, subtitle, image_url, cta_label, cta_href, sort_order)
select
  'SSUNI Fall 2026 Collection',
  'Hi U District',
  'Our humble beginnings',
  '/images/download.jpeg',
  'Explore the Catalog',
  '/catalog',
  0
where not exists (select 1 from public.hero_stories);

-- ---------------------------------------------------------------------------
-- RLS. Part of this migration, not a follow-up hardening task (ADR 0004).
-- ---------------------------------------------------------------------------

alter table public.hero_stories enable row level security;

-- Same shape as products_select_visible: anyone reads what is not Hidden, and an
-- admin additionally reads the Archive.
drop policy if exists hero_stories_select_visible on public.hero_stories;
create policy hero_stories_select_visible on public.hero_stories
  for select to anon, authenticated
  using (not is_hidden or private.is_admin());

drop policy if exists hero_stories_admin_write on public.hero_stories;
create policy hero_stories_admin_write on public.hero_stories
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- Grants, necessary in addition to the policies: current Supabase projects do
-- not auto-expose a new table to the Data API roles, so RLS alone would leave
-- this returning "permission denied" to everyone.
grant select on public.hero_stories to anon, authenticated;

-- Gated entirely by hero_stories_admin_write above; without is_admin() every one
-- of these is denied at the RLS layer.
grant insert, update, delete on public.hero_stories to authenticated;
