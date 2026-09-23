import { getPalette, type PaletteColor } from "@/lib/admin-catalog";
import { createColorAction, deleteColorAction, updateColorAction } from "./actions";

/**
 * The colour palette (#83).
 *
 * Every colour a Variant can be is a row here, and the Variant forms on the
 * Product editor choose from this list rather than accepting free text. That
 * is what makes a swatch on the storefront the colour the client actually
 * picked, instead of the grey fallback a hardcoded map produced for anything
 * it had never heard of.
 *
 * The picker is `<input type="color">` -- native, so no dependency, and it
 * cannot submit anything the `colors_hex_check` constraint would refuse.
 *
 * Delete is offered only at zero usage. `variants_color_fkey` is ON DELETE
 * RESTRICT, so the database refuses a colour in use regardless; showing the
 * count instead of a button means the client never meets that refusal. The
 * confirmation is a `<details>` rather than a JavaScript `confirm()`, so it
 * works with scripting off like every other form on the dashboard.
 */

export default async function AdminColorsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const palette = await getPalette();

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-2">
        <h2 className="font-cinzel text-2xl">Colours</h2>
      </div>

      <p className="font-belleza text-sm text-ssuni-slate mb-8 max-w-2xl">
        The shades your Products can be sold in. A Variant picks from this list, and the
        swatch a shopper sees on the product page is the colour you choose here.{" "}
        <strong className="text-ssuni-brown">Renaming</strong> one updates every Variant
        using it, including on past orders — a rename changes what a shade is called, not
        which shade someone bought.
      </p>

      {error && (
        <p role="alert" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-brown bg-ssuni-light2">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-sage bg-ssuni-sage/10">
          Saved.
        </p>
      )}

      {palette.length === 0 && (
        <p className="font-belleza text-sm text-ssuni-slate mb-5">
          No colours yet — add one below before adding Variants to a Product.
        </p>
      )}

      <ul className="mb-10">
        {palette.map((color) => (
          <ColorRow key={color.name} color={color} />
        ))}
      </ul>

      <section className="border border-ssuni-light2 p-5">
        <h3 className="font-cinzel text-xl mb-4">Add a colour</h3>
        <form action={createColorAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
              Name
            </span>
            <input
              name="name"
              placeholder="Charcoal"
              required
              className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
              Colour
            </span>
            <input
              type="color"
              name="hex"
              defaultValue="#8C947D"
              required
              className="border border-ssuni-light2 bg-ssuni-light1 h-[38px] w-20 cursor-pointer"
            />
          </label>

          <button
            type="submit"
            className="border border-ssuni-brown px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors cursor-pointer"
          >
            Add colour
          </button>
        </form>
      </section>
    </div>
  );
}

function ColorRow({ color }: { color: PaletteColor }) {
  return (
    <li className="flex flex-wrap items-end gap-3 border-b border-ssuni-light2 py-4">
      <form action={updateColorAction} className="flex flex-wrap items-end gap-3 grow">
        <input type="hidden" name="originalName" value={color.name} />

        <label className="flex flex-col gap-1">
          <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
            Name
          </span>
          <input
            name="name"
            defaultValue={color.name}
            required
            className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
            Colour
          </span>
          <input
            type="color"
            name="hex"
            defaultValue={color.hex}
            required
            className="border border-ssuni-light2 bg-ssuni-light1 h-[38px] w-20 cursor-pointer"
          />
        </label>

        <p className="font-belleza text-sm text-ssuni-slate pb-2">
          {color.variantCount === 0
            ? "Not used yet"
            : `In use by ${color.variantCount} ${color.variantCount === 1 ? "Variant" : "Variants"}`}
        </p>

        <button
          type="submit"
          className="border border-ssuni-light2 px-4 py-2 font-belleza uppercase tracking-widest text-xs hover:border-ssuni-brown transition-colors cursor-pointer"
        >
          Save
        </button>
      </form>

      {color.variantCount === 0 && (
        <details className="pb-1">
          <summary className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors cursor-pointer list-none">
            Remove
          </summary>
          <form action={deleteColorAction} className="mt-2">
            <input type="hidden" name="name" value={color.name} />
            <button
              type="submit"
              className="border border-ssuni-brown px-4 py-2 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors cursor-pointer"
            >
              Remove {color.name} for good
            </button>
          </form>
        </details>
      )}
    </li>
  );
}
