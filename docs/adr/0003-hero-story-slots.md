# Hero Stories use fixed, manually-curated Slots, not a rotating carousel

The landing page will host many Hero Stories over time, some advertising a specific collection or category rather than always the newest drop — a few are meant to stay featured indefinitely regardless of age. We chose a UNIQLO-style layout of a fixed number of simultaneous Hero Slots (one primary banner plus a few secondary tiles), each holding one Hero Story the client manually assigns and swaps via the Admin Dashboard, instead of an auto-rotating carousel ordered by recency. Timed rotation was considered and rejected: a shopper interested in a story is expected to click through immediately rather than wait for it to cycle back into view.

## Consequences

Revisiting timed rotation later is still possible without restructuring the Slot/Story data model — it would only add an optional per-Story display duration, not change how Slots are assigned.

## Amendment, 2026-09-18: Slots are replaced by an ordered, unbounded list

Building #22 made the Slot model the wrong shape before it was ever implemented. Hero Stories are now **an unbounded list of full-bleed panels that stack vertically down the landing page**, ordered by an integer the client sets, each individually Hidden or not. There is no fixed number of positions and no distinction between a primary banner and a secondary tile: adding a row in Supabase Studio adds a section to the home page.

The original decision assumed the landing page had a *fixed amount of hero real estate* that Stories competed for, which is what made assignment the interesting problem. That assumption came from the UNIQLO reference rather than from anything SSUNI needs. The client's actual request is to keep adding stories over time and have the page grow — so a Slot is a constraint the layout does not have, and the "which Story is in which Slot" workflow is a scarcity ritual around a resource that is not scarce.

What survives from the original decision is the part that mattered: **the client curates, and nothing rotates.** Order is explicit and manual (`sort_order`), not derived from recency; a Story stays where it is put, indefinitely, regardless of age. Timed rotation is still rejected for the original reason.

## Consequences

`hero_stories` carries `sort_order` and `is_hidden` and **no `slot` column**; the landing page renders every visible row in order. Hiding the last visible Story leaves a home page with no hero at all — accepted, because it is recoverable in one click by the person who caused it, and the alternative is a table that refuses to be empty.

The Slot vocabulary is retired from `CONTEXT.md`. It has never existed in code, so this costs no migration.

Two consequences are the layout's, not the schema's. **Every panel is a full-screen image**, so a client adding ten Stories ships ten of them — `components/HeroStory.tsx` lazy-loads all but the first, and if the count grows past what that comfortably carries, the answer is a shorter panel variant rather than a cap on rows. And the first Story carries the page's `<h1>` while the rest are `<h2>`, so the ordering is also the page's heading outline.

The Admin Dashboard (ADR 0007) now has a simpler surface to build than the one this ADR originally implied: a reorderable list with a visibility toggle, not a slot-assignment UI.

## Amendment, 2026-09-22: a Hidden Hero Story appears only in the Admin Dashboard

When the Admin Dashboard gains Hero Story management, `getHeroStories()` filters `is_hidden` explicitly and the landing page stops rendering Hidden Stories **for everybody, admins included**.

Until now Hero Stories followed Products: `hero_stories_select_visible` grants an admin the Archive, so a signed-in admin browsing the storefront was served Hidden Stories as a preview, exactly as they are served Hidden Products in the catalog. `lib/hero.ts` documents that behaviour and argues against a redundant filter, on the grounds that the database is already deciding.

The two are being deliberately split. A Hidden Product is a card in a grid, which a badge can mark and an admin can scroll past in a second. A Hidden Hero Story is a **full-screen panel** the admin has to scroll through on the way to the shop, and the first one even owns the page's `<h1>` — so the Archive does not read as a preview there, it reads as the home page being wrong. Once `/admin/hero` lists every Story with its Hidden state, the dashboard is simply the better place to see them, and nothing is lost.

The filter this adds is therefore **not** redundant with RLS. It encodes a rule RLS does not express: "admins do not preview the Archive on this surface." The policy still decides who *may* read a Hidden Story; this decides where they are *shown* one.

## Consequences

`getHeroStories()` gains `.eq("is_hidden", false)`, and the docblock in `lib/hero.ts` that explains the admin-sees-Archive behaviour is rewritten rather than deleted — a future reader who finds the filter and knows the Hidden-Product pattern will otherwise "fix" it back.

`app/page.tsx` already handles every Story being Hidden. That branch now also catches "every Story is Hidden *and* an admin is looking", which previously could not happen.

This is the one place the Product and Hero Story models deliberately disagree about Hidden. `CONTEXT.md` records the split under **Hidden**, so the glossary does not imply a single rule that two tables no longer share.
