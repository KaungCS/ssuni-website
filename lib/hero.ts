import { createClient } from "./supabase/server";

/**
 * Hero Story reads. Issue #22, per ADR 0003 (amended 2026-09-18).
 *
 * The only place the storefront queries `hero_stories`, the way lib/catalog.ts
 * is for the catalog and lib/orders.ts is for Orders. The Admin Dashboard
 * (ADR 0007, October) is the expected second caller, and it should extend this
 * file rather than writing its own query -- the Hidden rule below is the kind of
 * thing that silently diverges once two places know it.
 *
 * Like both of those modules this reaches `next/headers` through
 * lib/supabase/server.ts, so **no `"use client"` file may import a runtime value
 * from it**. Type-only imports are erased and are fine -- `components/HeroStory.tsx`
 * is a server component today, but the HeroStory type is what a future client
 * component should import.
 */

/** One Hero Story, as the landing page renders it. */
export type HeroStory = {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  /**
   * Non-null only when the row carried BOTH a label and a destination. The
   * component therefore never has to decide what a half-filled call to action
   * means -- a row with a label and no href renders as a Story with no button,
   * not as a link to nowhere.
   */
  cta: { label: string; href: string } | null;
};

export async function getHeroStories(): Promise<HeroStory[]> {
  const supabase = await createClient();

  // Hidden Stories are excluded by RLS (hero_stories_select_visible), so nothing
  // here filters on is_hidden -- exactly as lib/catalog.ts does not filter
  // Hidden Products. Adding a redundant client-side filter would imply the
  // database is not already doing it, which is the wrong thing to imply.
  //
  // One caveat worth knowing rather than coding around: that policy also grants
  // an admin the Archive, so a signed-in admin browsing the storefront sees
  // Hidden Stories on the home page. That is the same behaviour products already
  // have, and it is a preview rather than a leak.
  const { data, error } = await supabase
    .from("hero_stories")
    .select("id, eyebrow, title, subtitle, image_url, cta_label, cta_href, sort_order, created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load hero stories: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    eyebrow: row.eyebrow,
    title: row.title,
    subtitle: row.subtitle,
    imageUrl: row.image_url,
    cta: row.cta_label && row.cta_href ? { label: row.cta_label, href: row.cta_href } : null,
  }));
}
