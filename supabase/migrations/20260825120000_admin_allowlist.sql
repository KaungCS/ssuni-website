-- Admin allowlist.
--
-- ADR 0004 makes RLS the sole read/write boundary and says writes are restricted
-- to "the admin-allowlisted user", but no such mechanism existed. This defines it
-- once: issues #17 (orders), #21 (orders admin) and #22 (hero stories) all reuse
-- public.is_admin() rather than re-deriving what "admin" means per table.

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.admins is
  'Allowlist of users permitted to write catalog data. Managed by hand in Supabase Studio; there is no UI and deliberately no policy allowing the browser to read or modify it.';

-- RLS on with *zero* policies: unreachable from anon and authenticated alike.
-- The service role bypasses RLS, and the table owner (postgres, who runs
-- migrations) is exempt from its own RLS, which is what lets is_admin() below
-- read it.
alter table public.admins enable row level security;

revoke all on public.admins from anon, authenticated;

-- security definer is load-bearing, not incidental: every policy that calls this
-- runs as anon or authenticated, and neither of those roles can read
-- public.admins. Without definer rights the function returns false for everyone
-- and the admin write policies silently deny the admin too.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

comment on function public.is_admin() is
  'True when the calling user is in public.admins. SECURITY DEFINER because callers cannot read that table themselves.';

grant execute on function public.is_admin() to anon, authenticated;
