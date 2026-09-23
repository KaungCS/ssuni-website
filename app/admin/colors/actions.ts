"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { createColor, deleteColor, parseColorForm, updateColor } from "@/lib/admin-catalog";

/**
 * Palette writes for the Admin Dashboard (#83).
 *
 * Every one of these calls `requireAdmin()` first, for the reason
 * app/admin/products/actions.ts spells out: a Server Action is a POST endpoint
 * anyone can hit, and the layout that rendered the form is not in its request
 * path. RLS (`colors_admin_write`) is the actual boundary.
 *
 * Errors come back as `?error=`, so this page needs no client component and
 * keeps working with JavaScript off.
 */

function back(message?: string): never {
  redirect(message ? `/admin/colors?error=${encodeURIComponent(message)}` : "/admin/colors?saved=1");
}

export async function createColorAction(formData: FormData) {
  await requireAdmin();

  const fields = parseColorForm(formData);
  if ("error" in fields) back(fields.error);

  back((await createColor(fields)) ?? undefined);
}

export async function updateColorAction(formData: FormData) {
  await requireAdmin();

  // The name is editable, so the row is addressed by the name it had when the
  // page rendered rather than by the one in the form.
  const originalName = String(formData.get("originalName") ?? "");
  if (!originalName) back("Missing colour.");

  const fields = parseColorForm(formData);
  if ("error" in fields) back(fields.error);

  back((await updateColor(originalName, fields)) ?? undefined);
}

export async function deleteColorAction(formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "");
  if (!name) back("Missing colour.");

  back((await deleteColor(name)) ?? undefined);
}
