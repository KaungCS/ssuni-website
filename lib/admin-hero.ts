import { createClient } from "./supabase/server";

/**
 * Hero Stories for the Admin Dashboard (#75, #77, #78), per ADR 0003 as amended
 * twice and ADR 0007 as amended 2026-09-19.
 *
 * Stands to `lib/hero.ts` as `lib/admin-catalog.ts` stands to `lib/catalog.ts`,
 * and is separate for the same reason those two are: the shapes genuinely
 * differ. The storefront wants visible Stories with their call to action already
 * resolved to "button or no button"; the dashboard wants every Story including
 * the Hidden ones, with the raw column values it has to put back in a form, and
 * with the ordering it has to rewrite.
 *
 * **Writes go through RLS with the publishable key.** `hero_stories_admin_write`
 * is the boundary (ADR 0004) — a non-admin who POSTs straight at a Server Action
 * is refused by the policy, not only by `requireAdmin()`. Nothing here imports
 * lib/supabase/admin.ts, and nothing here should.
 *
 * Like lib/catalog.ts, lib/orders.ts and lib/admin-catalog.ts this reaches
 * next/headers through lib/supabase/server.ts, so **no `"use client"` file may
 * import a runtime value from it**. Type-only imports are erased and are fine.
 */

/** One Hero Story as the dashboard edits it: every column, nothing derived. */
export type AdminHeroStory = {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  /**
   * Empty string for a Story created in the dashboard and not yet given an
   * image. The column is `not null` and #75 rules out a migration, so "" is
   * how "no image yet" is spelled — which is why every render of this field
   * branches on it rather than handing `next/image` a `src=""`, which throws.
   */
  imageUrl: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  isHidden: boolean;
  sortOrder: number;
};

const ADMIN_HERO_SELECT =
  "id, eyebrow, title, subtitle, image_url, cta_label, cta_href, is_hidden, sort_order";

/**
 * Every Story in display order, Hidden ones included.
 *
 * Hidden Stories appear here because `hero_stories_select_visible` is
 * `not is_hidden or private.is_admin()` — the same query returns the Archive to
 * an admin and the published list to a shopper. There is no `is_hidden` filter
 * in this module to get wrong; `lib/hero.ts` is the one that carries a filter,
 * and its docblock explains why that is not a contradiction.
 *
 * Ties break on `created_at` exactly as the storefront's query does, so the two
 * pages cannot disagree about the order of two rows sharing a number — which a
 * crash mid-renumber can leave behind (see `applyHeroOrder`).
 */
export async function getAdminHeroStories(): Promise<AdminHeroStory[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("hero_stories")
    .select(ADMIN_HERO_SELECT)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load hero stories: ${error.message}`);

  return (data ?? []).map(toAdminHeroStory);
}

/** One Story, or null when the id matches nothing the admin may see. */
export async function getAdminHeroStory(id: string): Promise<AdminHeroStory | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("hero_stories")
    .select(ADMIN_HERO_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load hero story ${id}: ${error.message}`);

  return data ? toAdminHeroStory(data) : null;
}

type HeroRow = {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  image_url: string;
  cta_label: string | null;
  cta_href: string | null;
  is_hidden: boolean;
  sort_order: number;
};

function toAdminHeroStory(row: HeroRow): AdminHeroStory {
  return {
    id: row.id,
    eyebrow: row.eyebrow,
    title: row.title,
    subtitle: row.subtitle,
    imageUrl: row.image_url,
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    isHidden: row.is_hidden,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * The list `ids` with `id` moved to `toIndex`. Pure, and 0-based.
 *
 * Both dashboard controls are this one function with a different argument: an
 * arrow is "move to my position ± 1", and the Position box is "move to position
 * N, everything from N onward shifts down". The box is 1-based where the client
 * sees it — `app/admin/hero/actions.ts` does that subtraction — because "type 1
 * to make it first" is what a non-technical person means by a position.
 *
 * Out-of-range positions clamp rather than throw: the box is a number input the
 * client can type anything into, and an id that is not in the list is a stale
 * page submitting a Story someone deleted, where renumbering the survivors
 * around a ghost is worse than doing nothing.
 */
export function reorderIds(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];

  const to = Math.min(Math.max(toIndex, 0), ids.length - 1);
  if (to === from) return [...ids];

  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Moves one Story to `toIndex` and renumbers the list to `0…n-1`.
 *
 * Dense and unique is a *result* of every reorder, not a database constraint.
 * There is deliberately no unique index on `sort_order`:
 * `20260919120000_product_images.sql:34` rejected exactly that for a mechanical
 * reason that still holds here — supabase-js sends each UPDATE in its own
 * transaction, so any swap passes through a state where two rows share a
 * number, which a unique index turns into a failed write plus a temporary-value
 * dance.
 *
 * Only the rows whose number actually changes are written. That is not just
 * fewer round trips: the client may have typed arbitrary integers into
 * `sort_order` in Supabase Studio, so "already at the right index" and "already
 * holding the right number" are different questions, and this asks the second.
 *
 * ponytail: N sequential non-atomic updates. A handful of rows, one editor, and
 * a crash mid-renumber still leaves a totally ordered list, because both this
 * module and lib/hero.ts break ties on `created_at`. Upgrade path if it ever
 * matters: one `reorder_hero_stories(uuid[])` RPC doing it in a single
 * statement.
 */
export async function applyHeroOrder(id: string, toIndex: number): Promise<string | null> {
  const stories = await getAdminHeroStories();
  const ordered = reorderIds(
    stories.map((s) => s.id),
    id,
    toIndex,
  );

  const current = new Map(stories.map((s) => [s.id, s.sortOrder]));
  const supabase = await createClient();

  for (const [index, storyId] of ordered.entries()) {
    if (current.get(storyId) === index) continue;

    const { error } = await supabase
      .from("hero_stories")
      .update({ sort_order: index })
      .eq("id", storyId);

    if (error) return writeError(error.message);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Writes. Each returns an error string or null, so callers can report rather
// than throw -- an empty title is an ordinary thing for the client to submit.
// ---------------------------------------------------------------------------

export type HeroFields = {
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  isHidden: boolean;
};

/**
 * FormData to HeroFields, validating only what the database cannot say for
 * itself.
 *
 * Two absences are deliberately *not* errors. A half-filled call to action
 * saves: the schema permits a label without a link, `components/HeroStory.tsx`
 * renders a Story with no button rather than a link to nowhere, and an editor
 * that refuses to save cannot hold a half-drafted row. The page warns under the
 * pair instead.
 *
 * `""` and `null` are genuinely different answers for the nullable columns —
 * the storefront's `cta_label && cta_href` test treats "" as absent, but a row
 * full of empty strings is a row nobody can tell apart from a row that was
 * filled in with nothing. Blank means null here.
 */
export function parseHeroForm(form: FormData): HeroFields | { error: string } {
  const title = String(form.get("title") ?? "").trim();
  if (title === "") return { error: "A Hero Story needs a title." };

  return {
    eyebrow: blankToNull(form.get("eyebrow")),
    title,
    subtitle: blankToNull(form.get("subtitle")),
    ctaLabel: blankToNull(form.get("ctaLabel")),
    ctaHref: blankToNull(form.get("ctaHref")),
    isHidden: form.get("isHidden") !== null,
  };
}

function blankToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

/**
 * A new Story: a title, no image, Hidden, and last in the order.
 *
 * Hidden because a full-bleed panel is a loud thing to half-build in public —
 * the same call `app/admin/products/page.tsx` makes for a new Product, and
 * louder here. It is also what makes the empty `image_url` safe: `lib/hero.ts`
 * filters Hidden Stories out, so an image-less Story cannot reach the landing
 * page, and `setHeroFields` refuses to unhide one.
 */
export async function createHeroStory(
  title: string,
  sortOrder: number,
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("hero_stories")
    .insert({ title, image_url: "", is_hidden: true, sort_order: sortOrder })
    .select("id")
    .maybeSingle();

  if (error) return { error: writeError(error.message) };
  if (!data) return { error: "The Hero Story was not created." };
  return { id: data.id };
}

/**
 * Saves the editable fields of a Story.
 *
 * `hasImage` is passed in rather than re-read, because the one thing this
 * refuses is the one thing that can take the landing page down: `next/image`
 * with `src=""` throws, and the first Story owns the page's `<h1>`. A missing
 * call to action is a degraded Story and saves with a warning; a missing image
 * is a blank screen, so showing one is refused outright.
 */
export async function updateHeroStory(
  id: string,
  fields: HeroFields,
  hasImage: boolean,
): Promise<string | null> {
  if (!fields.isHidden && !hasImage) {
    return "This Hero Story has no image yet, so it cannot be shown on the home page. Upload one first.";
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("hero_stories")
    .update({
      eyebrow: fields.eyebrow,
      title: fields.title,
      subtitle: fields.subtitle,
      cta_label: fields.ctaLabel,
      cta_href: fields.ctaHref,
      is_hidden: fields.isHidden,
    })
    .eq("id", id);

  return error ? writeError(error.message) : null;
}

/** Records an image the browser has already uploaded to Storage. */
export async function setHeroImage(id: string, url: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("hero_stories").update({ image_url: url }).eq("id", id);
  return error ? writeError(error.message) : null;
}

/**
 * Removes the row. The file stays in the bucket, deliberately — the same trade
 * `deleteImage` in lib/admin-catalog.ts spells out: a Storage delete is a second
 * failure mode on a different service, and an orphaned object costs a few
 * kilobytes against a quota.
 *
 * Nothing in the database references a Hero Story, so unlike a sold Product
 * there is no foreign key to refuse this. The confirmation in the dashboard is
 * the only thing between a misclick and losing the copy and the image.
 */
export async function deleteHeroStory(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("hero_stories").delete().eq("id", id);
  return error ? writeError(error.message) : null;
}

/**
 * Postgres speaks to the database; the client should hear about the mistake they
 * actually made. Only what the client can cause by typing is translated —
 * anything else passes through, because a swallowed message is worse than an
 * ugly one. Same rule as `writeError` in lib/admin-catalog.ts, and separate from
 * it because the constraints are a different set.
 */
function writeError(message: string): string {
  if (message.includes("hero_stories_title_check") || message.includes("null value in column")) {
    return "A Hero Story needs a title.";
  }
  if (message.includes("row-level security")) {
    return "The database refused that write. Are you still signed in as an admin?";
  }
  return message;
}
