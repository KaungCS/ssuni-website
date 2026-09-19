-- Let a signed-in user ask whether *they* are an admin. Issue #21.
--
-- 20260825120000_admin_allowlist.sql created public.admins with RLS on and zero
-- policies, and said so deliberately: "there is no UI and deliberately no policy
-- allowing the browser to read or modify it." That was right for what existed
-- then -- every consumer of is_admin() was a policy expression evaluated inside
-- Postgres, so nothing in a browser ever needed to know.
--
-- The Admin Dashboard (ADR 0007, amended 2026-09-19) needs to know, because it
-- has to decide what to *render*: app/admin/layout.tsx answers notFound() to a
-- signed-in non-admin. There is currently no way to ask. private.is_admin()
-- exists but 20260825130000 moved it into the `private` schema precisely so
-- PostgREST could not reach it -- that is the documented remediation for linter
-- 0028/0029, and re-exposing a SECURITY DEFINER function in `public` to get an
-- answer would trade a real advisor finding for a convenience.
--
-- So: the narrowest possible read instead. `using (user_id = auth.uid())` means
-- the only row anyone can see is their own, which answers "am I an admin" and
-- nothing else. The allowlist stays unenumerable -- an admin cannot list other
-- admins, a customer gets an empty result, and anon has no grant and no policy
-- at all. The original comment's concern was enumeration, and this preserves it.
--
-- This gate is UX, not security. ADR 0004 is unambiguous that RLS is the sole
-- read/write boundary: every admin page's data is already protected by
-- products_admin_write, orders_admin_all and friends, so a non-admin who
-- defeated this check would still be served nothing. It decides whether to show
-- a page, not whether to trust one.

drop policy if exists admins_select_self on public.admins;
create policy admins_select_self on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- Note the asymmetry with the other tables: SELECT only, and only to
-- authenticated. No insert/update/delete grant is issued, so the allowlist
-- remains editable exclusively in Supabase Studio with the service role --
-- an Admin Dashboard that could add admins to itself is a privilege-escalation
-- surface, and the dashboard has no reason to want one.
grant select on public.admins to authenticated;

comment on policy admins_select_self on public.admins is
  'Answers "am I an admin" for the Admin Dashboard gate (#21) and nothing more -- one row, your own. The allowlist stays unenumerable and unwritable from a browser.';
