"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Uploads an image straight from the browser to Supabase Storage, then hands the
 * resulting public URL to a Server Action to record.
 *
 * Not Product-shaped, deliberately (#77). It takes a path prefix and whatever
 * hidden fields its Server Action needs, so the Product gallery and the Hero
 * Story editor share one upload rather than one each — two copies of this is how
 * one of them keeps `upsert: false` and the other quietly loses it. Both write
 * into the **same bucket**: `product_images_storage_admin_write` is scoped to
 * `bucket_id = 'product-images'` and an admin check, with no opinion about the
 * path, so a `hero/` prefix needs no migration and no second policy. The
 * bucket's name is mildly wrong for the contents; a second bucket would be a
 * migration, two policies and an `rls.mjs` section to fix a noun.
 *
 * The bytes never cross the worker. That is the point: on Cloudflare a request
 * body has a size ceiling and a memory cost, and routing a photograph through a
 * Server Action buys no safety — the bucket's own policy
 * (`product_images_storage_admin_write`, `bucket_id = 'product-images' and
 * private.is_admin()`) is the boundary either way. A customer who called this
 * code is refused by Storage, not by this component.
 *
 * The one client component in the dashboard, and only because a file input has
 * no server-rendered equivalent. It therefore may not import a runtime value
 * from lib/admin-catalog.ts, lib/catalog.ts or lib/orders.ts — all three reach
 * next/headers. Importing the Server Action is fine; that is a reference, not
 * the module.
 */
export default function AdminImageUploader({
  pathPrefix,
  hiddenFields,
  action,
  label = "Add an image",
}: {
  /** Folder inside the bucket, so it stays navigable in Studio: a Product id, or `hero/<id>`. */
  pathPrefix: string;
  /** Whatever the Server Action needs alongside the URL -- a Product id and a sort order, or a Story id. */
  hiddenFields: Record<string, string>;
  action: (formData: FormData) => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    const supabase = createClient();

    // Prefixed so the bucket stays navigable in Studio, and suffixed with a
    // timestamp so re-uploading a file of the same name does not overwrite the
    // previous one — the old row would then point at new bytes.
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "-");
    const path = `${pathPrefix}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(path, file, { cacheControl: "31536000", upsert: false });

    if (uploadError) {
      // The expected failure here is the RLS policy refusing a non-admin, which
      // arrives as "new row violates row-level security policy".
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("product-images").getPublicUrl(path);

    // Hand off to the Server Action, which does the database write under RLS.
    if (urlRef.current) urlRef.current.value = publicUrl;
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="url" ref={urlRef} />

      <label className="flex flex-col gap-1">
        <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
          {label}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset the input so choosing the same file twice still fires.
            e.target.value = "";
            if (file) void upload(file);
          }}
          className="font-belleza text-sm file:font-belleza file:text-xs file:uppercase file:tracking-widest file:border file:border-ssuni-light2 file:bg-ssuni-light1 file:px-4 file:py-2 file:mr-3 file:cursor-pointer disabled:opacity-50"
        />
      </label>

      {busy && (
        <p role="status" className="font-belleza text-xs text-ssuni-slate">
          Uploading…
        </p>
      )}
      {error && (
        <p role="alert" className="font-belleza text-xs text-ssuni-brown">
          {error}
        </p>
      )}
    </form>
  );
}
