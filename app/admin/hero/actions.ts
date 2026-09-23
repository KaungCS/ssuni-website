"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import {
  applyHeroOrder,
  createHeroStory,
  deleteHeroStory,
  getAdminHeroStories,
  getAdminHeroStory,
  parseHeroForm,
  setHeroImage,
  updateHeroStory,
} from "@/lib/admin-hero";

/**
 * Hero Story writes for the Admin Dashboard (#77, #78).
 *
 * Every one of these calls `requireAdmin()` first, and that is not redundant
 * with app/admin/layout.tsx: a Server Action is a POST endpoint anyone can hit
 * directly, and the layout that rendered the form is not in its request path.
 * RLS would still refuse the write -- `hero_stories_admin_write` is the actual
 * boundary (ADR 0004) -- but a 404 beats a confusing no-op.
 *
 * Errors come back as a `?error=` query parameter, so these pages need no client
 * component and keep working with JavaScript off. The one exception is the
 * confirmation on delete, which degrades to a plain submit.
 */

function toList(message?: string): never {
  redirect(message ? `/admin/hero?error=${encodeURIComponent(message)}` : "/admin/hero?saved=1");
}

function toEditor(id: string, message?: string): never {
  redirect(
    message
      ? `/admin/hero/${id}?error=${encodeURIComponent(message)}`
      : `/admin/hero/${id}?saved=1`,
  );
}

export async function createHeroStoryAction(formData: FormData) {
  await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  if (title === "") toList("A Hero Story needs a title.");

  // Appended to the end rather than inserted anywhere clever: a new Story is
  // Hidden, so where it sits is invisible until the client says otherwise, and
  // the reorder controls are one click away.
  const stories = await getAdminHeroStories();

  const result = await createHeroStory(title, stories.length);
  if ("error" in result) toList(result.error);

  // Straight into the editor, as createProductAction does: a Story with no
  // image is not finished, and the list page cannot fix that.
  toEditor(result.id);
}

export async function updateHeroStoryAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("storyId") ?? "");
  if (!id) toList("Missing Hero Story.");

  const fields = parseHeroForm(formData);
  if ("error" in fields) toEditor(id, fields.error);

  // Read back rather than trusting a hidden field for it: whether the Story has
  // an image is the one thing this refuses to be wrong about, because showing an
  // image-less Story hands `next/image` a `src=""` and takes the landing page
  // down with it.
  const story = await getAdminHeroStory(id);
  if (!story) toList("That Hero Story no longer exists.");

  toEditor(id, (await updateHeroStory(id, fields, story.imageUrl !== "")) ?? undefined);
}

/**
 * Records an image the browser has *already* uploaded to Storage.
 *
 * The upload itself happens client-side in components/AdminImageUploader.tsx,
 * against the bucket's own RLS -- routing the bytes through a Server Action
 * would mean the file crossing the worker for no security gain.
 */
export async function setHeroImageAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("storyId") ?? "");
  if (!id) toList("Missing Hero Story.");

  const url = String(formData.get("url") ?? "").trim();
  if (url === "") toEditor(id, "That upload produced no URL.");

  toEditor(id, (await setHeroImage(id, url)) ?? undefined);
}

export async function deleteHeroStoryAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("storyId") ?? "");
  if (!id) toList("Missing Hero Story.");

  const error = await deleteHeroStory(id);
  if (error) toEditor(id, error);

  redirect("/admin/hero?deleted=1");
}

/**
 * Both ordering controls, with a different argument.
 *
 * The arrows post an absolute `position` computed from the row's own index when
 * the page rendered, rather than a direction -- so a double-click on ↑ moves a
 * Story one place, twice, instead of racing against a list that has changed
 * underneath it.
 *
 * **The Position box is 1-based and `reorderIds` is 0-based**, and this is the
 * only place that subtraction happens. "Type 1 to make it first" is what a
 * non-technical client means by a position; `sort_order` in the database stays
 * 0-based, as `product_images` already is.
 */
export async function reorderHeroStoryAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("storyId") ?? "");
  if (!id) toList("Missing Hero Story.");

  const position = Number(String(formData.get("position") ?? "").trim());
  if (!Number.isInteger(position)) toList("Position must be a whole number.");

  // Out-of-range clamps rather than refusing: `reorderIds` treats the position
  // as a request, and a client typing 99 into a list of four plainly means last.
  toList((await applyHeroOrder(id, position - 1)) ?? undefined);
}
