import Image from "next/image";
import Link from "next/link";
import { getAdminHeroStories, type AdminHeroStory } from "@/lib/admin-hero";
import { createHeroStoryAction, reorderHeroStoryAction } from "./actions";

/**
 * Every Hero Story, Hidden ones included. Issues #77 and #78, per ADR 0003 as
 * amended twice.
 *
 * Hidden Stories appear here because `hero_stories_select_visible` is
 * `not is_hidden or private.is_admin()` -- the same query returns the Archive to
 * an admin and the published list to a shopper. There is no `is_hidden` filter
 * in this page to get wrong.
 *
 * This is now the *only* place a Hidden Story is visible: the landing page
 * filters them out for everybody, admins included (the 2026-09-22 amendment to
 * ADR 0003). A full-bleed panel is too large to read as a preview the way a
 * Hidden Product's card does, and the first Story on the page owns its `<h1>`.
 *
 * Every form is an uncontrolled <form> posting to a Server Action, so the page
 * needs no client state and works with JavaScript off.
 */

export default async function AdminHeroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
}) {
  const { error, saved, deleted } = await searchParams;
  const stories = await getAdminHeroStories();

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-2">
        <h2 className="font-cinzel text-2xl">Hero Stories</h2>
        <p className="font-belleza text-sm text-ssuni-slate">
          {stories.length} {stories.length === 1 ? "story" : "stories"}
        </p>
      </div>
      <p className="font-belleza text-sm text-ssuni-slate mb-8">
        The full-screen panels down the home page, in the order they appear. Hidden ones are not
        shown to anyone, including you — this page is where they live.
      </p>

      {error && (
        <p role="alert" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-brown bg-ssuni-light2">
          {error}
        </p>
      )}
      {deleted && !error && (
        <p role="status" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-sage bg-ssuni-sage/10">
          Hero Story deleted.
        </p>
      )}
      {saved && !error && !deleted && (
        <p role="status" className="font-belleza text-sm px-4 py-3 mb-8 border border-ssuni-sage bg-ssuni-sage/10">
          Saved.
        </p>
      )}

      <form
        action={createHeroStoryAction}
        className="flex flex-wrap items-end gap-3 border border-ssuni-light2 p-5 mb-10"
      >
        <label className="flex flex-col gap-1 grow min-w-[14rem]">
          <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
            Title
          </span>
          <input
            name="title"
            required
            placeholder="Hi U District"
            className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="bg-ssuni-brown text-ssuni-light1 px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-slate transition-colors cursor-pointer"
        >
          Add story
        </button>
        <p className="font-belleza text-xs text-ssuni-slate basis-full">
          Created Hidden and last in the order, so nothing appears on the home page until you have
          added a picture and said so.
        </p>
      </form>

      {stories.length === 0 ? (
        <p className="font-belleza text-ssuni-slate border-t border-ssuni-light2 pt-10">
          No hero stories yet. The home page shows its plain brand panel until there is one.
        </p>
      ) : (
        <ul className="border-t border-ssuni-light2">
          {stories.map((story, index) => (
            <StoryRow key={story.id} story={story} index={index} total={stories.length} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StoryRow({
  story,
  index,
  total,
}: {
  story: AdminHeroStory;
  index: number;
  total: number;
}) {
  return (
    <li className="border-b border-ssuni-light2 flex flex-wrap items-center gap-x-6 gap-y-4 py-5">
      <Link
        href={`/admin/hero/${story.id}`}
        className="flex items-center gap-5 grow min-w-[16rem] hover:opacity-70 transition-opacity"
      >
        <span className="relative shrink-0 w-24 aspect-[3/2] bg-ssuni-light2 overflow-hidden">
          {/* An empty `image_url` is how a Story created here says "no picture
              yet" -- the column is `not null` and #75 rules out a migration. It
              must never reach next/image, which throws on src="". */}
          {story.imageUrl === "" ? (
            <span className="absolute inset-0 flex items-center justify-center font-belleza text-[0.6rem] uppercase tracking-widest text-ssuni-slate">
              No image
            </span>
          ) : (
            <Image src={story.imageUrl} alt="" fill sizes="96px" className="object-cover" />
          )}
        </span>

        <span>
          <span className="font-belleza text-ssuni-brown">
            {story.title}
            {story.isHidden && (
              <span className="ml-3 text-xs uppercase tracking-widest text-ssuni-slate">
                Hidden
              </span>
            )}
          </span>
          <span className="font-belleza block text-sm text-ssuni-slate">
            {story.eyebrow ?? "No eyebrow"}
            {story.imageUrl === "" && " · no picture"}
            {!story.ctaLabel && !story.ctaHref && " · no button"}
          </span>
        </span>
      </Link>

      {/* Ordering. Both controls post an absolute position to one action: the
          arrows compute it from this row's index, the box takes it from the
          client. Position is 1-based here and 0-based in the database, which
          app/admin/hero/actions.ts is the only place to reconcile. */}
      <div className="flex items-center gap-2 shrink-0">
        <Arrow storyId={story.id} position={index} label="Move up" glyph="↑" disabled={index === 0} />
        <Arrow
          storyId={story.id}
          position={index + 2}
          label="Move down"
          glyph="↓"
          disabled={index === total - 1}
        />

        <form action={reorderHeroStoryAction} className="flex items-center gap-2 ml-2">
          <input type="hidden" name="storyId" value={story.id} />
          <input
            type="number"
            name="position"
            min="1"
            step="1"
            defaultValue={index + 1}
            aria-label={`Position of ${story.title}`}
            className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-2 py-1 text-sm w-16"
          />
          <button
            type="submit"
            className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors cursor-pointer"
          >
            Move
          </button>
        </form>
      </div>
    </li>
  );
}

/**
 * One arrow. A form rather than a link, because this is a write -- and an
 * absolute destination rather than a direction, so a double-click moves the
 * Story twice instead of racing a list that has shifted underneath it.
 */
function Arrow({
  storyId,
  position,
  label,
  glyph,
  disabled,
}: {
  storyId: string;
  position: number;
  label: string;
  glyph: string;
  disabled: boolean;
}) {
  return (
    <form action={reorderHeroStoryAction}>
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="position" value={position} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={label}
        className="font-belleza border border-ssuni-light2 px-2.5 py-1 text-sm hover:border-ssuni-brown transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:border-ssuni-light2"
      >
        {glyph}
      </button>
    </form>
  );
}
