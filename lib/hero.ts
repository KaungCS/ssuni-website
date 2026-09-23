import { createClient } from "./supabase/server";

/**
 * Hero Story reads. Issue #22, per ADR 0003 (amended 2026-09-18 and 2026-09-22).
 *
 * The only place the *storefront* queries `hero_stories`, the way lib/catalog.ts
 * is for the catalog and lib/orders.ts is for Orders. The Admin Dashboard reads
 * the same table through lib/admin-hero.ts, which is a separate module rather
 * than an extension of this one because the shapes genuinely differ: the
 * dashboard wants every Story including the Archive, with raw column values to
 * put back in a form.
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

  // **This filter is not redundant with RLS, and it is not a mistake.** Per the
  // 2026-09-22 amendment to ADR 0003, it encodes a rule the policy does not
  // express: admins do not preview the Archive *on this surface*.
  //
  // `hero_stories_select_visible` is `not is_hidden or private.is_admin()`, so
  // without this line a signed-in admin browsing the storefront is served every
  // Hidden Story on the home page -- exactly the arrangement Hidden Products
  // still have in the catalog, where lib/catalog.ts deliberately does NOT filter.
  //
  // The two were split on purpose. A Hidden Product is one card in a grid
  // carrying a Hidden pill: a preview an admin scrolls past in a second. A
  // Hidden Hero Story is a full-screen panel they have to scroll *through*, and
  // the first one owns the page's <h1> -- so the Archive does not read as a
  // preview there, it reads as the home page being broken. /admin/hero now lists
  // every Story with its Hidden state, so nothing is lost by taking them off the
  // storefront.
  //
  // If you arrived here knowing the Hidden-Product pattern and reached for the
  // delete key: that is the reaction this comment exists for. The policy decides
  // who *may* read a Hidden Story; this decides where they are *shown* one.
  const { data, error } = await supabase
    .from("hero_stories")
    .select("id, eyebrow, title, subtitle, image_url, cta_label, cta_href, sort_order, created_at")
    .eq("is_hidden", false)
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
