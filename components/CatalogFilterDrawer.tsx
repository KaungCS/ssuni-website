"use client";

import React, { useEffect, useRef, useState } from "react";
import Form from "next/form";
import Link from "next/link";
// Imported from lib/catalog-url, never lib/catalog: the latter reaches
// `next/headers` through the server Supabase client, and pulling it into a
// client component fails the build outright.
import {
  CATALOG_SORTS,
  type CatalogFacets,
  type CatalogFilters,
  type CatalogSort,
} from "@/lib/catalog-url";
import { categoryLabel, collectionLabel, departmentLabel } from "@/lib/taxonomy";

/**
 * The catalog filter and sort drawer. Issue #37, follow-on to #10.
 *
 * This is a GET form, not a controlled React form. `next/form` encodes the
 * fields into the query string and does a client-side navigation, so the URL
 * stays the single source of truth for what the shopper is looking at: a
 * filtered, sorted view survives a refresh and can be shared. Checkboxes that
 * share a `name` emit repeated params -- `?category=tees&category=hoodies` --
 * which is exactly the multi-value contract parseCatalogFilters already reads.
 *
 * Two consequences worth knowing before editing:
 *
 * - Every field is uncontrolled. `defaultChecked` comes from the server-parsed
 *   filters and the browser owns the rest, which is why the only state in here
 *   is open/closed and why the drawer still works with JavaScript disabled.
 *
 * - A GET form replaces the WHOLE query string. Any param the drawer does not
 *   render a field for is dropped on Apply -- which is why New Arrivals gets a
 *   real checkbox below rather than a hidden input. A hidden input would
 *   preserve `?new=true` but leave the shopper no way to switch it off.
 *
 * Filters apply on an explicit Apply press rather than on every tick. Catalog
 * pages are force-dynamic, so an instant-apply drawer would spend a full
 * Supabase round trip per checkbox.
 */

type Props = {
  /** Only terms that currently have Products -- see getCatalogFacets(). */
  facets: CatalogFacets;
  filters: CatalogFilters;
  sort: CatalogSort;
  /**
   * The current search-param string, used as the form's `key`.
   *
   * Without it: tick three boxes, close the drawer without applying, reopen --
   * and the stale ticks are still there, because nothing unmounted and the
   * browser kept them. Re-keying on the URL makes reopening always show what the
   * URL actually says.
   */
  paramsKey: string;
};

type FacetOption = { value: string; label: string };

/**
 * A titled group of inputs, with a rule above it.
 *
 * The rule sits on a wrapper rather than on the <fieldset> itself: a <legend> is
 * drawn inside its fieldset's border box, so `border-t` on the fieldset renders
 * only to the right of the label, which reads as a broken rule rather than a
 * styled one.
 */
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-ssuni-brown/15 pt-5">
      <fieldset>
        <legend className="font-cinzel text-sm tracking-wider text-ssuni-brown mb-3">
          {title}
        </legend>
        <div className="space-y-3">{children}</div>
      </fieldset>
    </div>
  );
}

function FacetGroup({
  title,
  name,
  options,
  selected,
}: {
  title: string;
  name: string;
  options: FacetOption[];
  selected: readonly string[];
}) {
  if (options.length === 0) return null;

  return (
    <DrawerSection title={title}>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex items-center gap-3 font-belleza text-stone-700 cursor-pointer hover:text-ssuni-brown transition-colors"
        >
          <input
            type="checkbox"
            name={name}
            value={option.value}
            defaultChecked={selected.includes(option.value)}
            className="w-4 h-4 accent-ssuni-brown cursor-pointer"
          />
          {option.label}
        </label>
      ))}
    </DrawerSection>
  );
}

export default function CatalogFilterDrawer({ facets, filters, sort, paramsKey }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);

    // The grid behind the drawer scrolling under a shopper's thumb is the single
    // most common mobile drawer complaint. Restore the previous value rather
    // than clearing it, so this composes with anything else that locks scroll.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    panelRef.current?.focus();

    // Captured now rather than read in the cleanup: the trigger stays mounted
    // for the drawer's whole life, so this is the same node either way, and
    // reading a ref during cleanup is the pattern the lint rule warns about.
    const trigger = triggerRef.current;

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="font-belleza uppercase tracking-widest text-sm text-ssuni-brown hover:opacity-70 transition-opacity border-b border-ssuni-brown pb-1"
      >
        Filter &amp; Sort +
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-ssuni-brown/25"
            aria-hidden="true"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Filter and sort"
            tabIndex={-1}
            className="fixed top-0 right-0 z-50 h-full w-full sm:w-[400px] bg-ssuni-light1 shadow-xl flex flex-col outline-none"
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-ssuni-brown/20">
              <h2 className="font-cinzel text-xl tracking-wide text-ssuni-brown">
                Filter &amp; Sort
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close filter and sort"
                className="font-belleza text-2xl leading-none text-stone-500 hover:text-ssuni-brown transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Closing on submit is safe: onSubmit only breaks <Form> if it
                calls preventDefault, which would cancel the navigation. */}
            <Form
              key={paramsKey}
              action="/catalog"
              onSubmit={() => setOpen(false)}
              className="flex flex-col flex-1 min-h-0"
            >
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                <label className="flex items-center gap-3 font-belleza text-stone-700 cursor-pointer hover:text-ssuni-brown transition-colors">
                  <input
                    type="checkbox"
                    name="new"
                    value="true"
                    defaultChecked={filters.isNew}
                    className="w-4 h-4 accent-ssuni-brown cursor-pointer"
                  />
                  New Arrivals
                </label>

                <FacetGroup
                  title="Department"
                  name="department"
                  options={facets.departments.map((slug) => ({
                    value: slug,
                    label: departmentLabel(slug),
                  }))}
                  selected={filters.departments}
                />

                <FacetGroup
                  title="Category"
                  name="category"
                  options={facets.categories.map((slug) => ({
                    value: slug,
                    label: categoryLabel(slug),
                  }))}
                  selected={filters.categories}
                />

                <FacetGroup
                  title="Collection"
                  name="collection"
                  options={facets.collections.map((slug) => ({
                    value: slug,
                    label: collectionLabel(slug),
                  }))}
                  selected={filters.collections}
                />

                <DrawerSection title="Sort By">
                  {CATALOG_SORTS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-3 font-belleza text-stone-700 cursor-pointer hover:text-ssuni-brown transition-colors"
                    >
                      <input
                        type="radio"
                        name="sort"
                        value={option.value}
                        defaultChecked={sort === option.value}
                        className="w-4 h-4 accent-ssuni-brown cursor-pointer"
                      />
                      {option.label}
                    </label>
                  ))}
                </DrawerSection>
              </div>

              <div className="flex items-center gap-4 px-6 py-5 border-t border-ssuni-brown/20 bg-ssuni-light1">
                {/* The button deliberately does not name a result count. Nothing
                    recomputes it as boxes are ticked, so "Show 12 pieces" would
                    be describing the view the shopper is leaving. */}
                <button
                  type="submit"
                  className="flex-1 font-belleza uppercase tracking-widest text-sm bg-ssuni-brown text-ssuni-light1 py-3 hover:opacity-90 transition-opacity"
                >
                  Apply
                </button>
                <Link
                  href="/catalog"
                  onClick={() => setOpen(false)}
                  className="font-belleza uppercase tracking-widest text-sm text-stone-500 hover:text-ssuni-brown transition-colors"
                >
                  Clear all
                </Link>
              </div>
            </Form>
          </div>
        </>
      )}
    </>
  );
}
