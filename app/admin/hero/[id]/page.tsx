import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminImageUploader from "@/components/AdminImageUploader";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { getAdminHeroStory } from "@/lib/admin-hero";
import { deleteHeroStoryAction, setHeroImageAction, updateHeroStoryAction } from "../actions";

/**
 * One Hero Story, in full. Issue #77, per ADR 0003 as amended twice.
 *
 * Shaped like app/admin/products/[id]/page.tsx on purpose: the client learns one
 * idiom -- a list page plus an editor per row -- and the next reader finds one
 * file shape. Every form is an uncontrolled <form> posting to a Server Action,
 * so there is no client state and the page works with JavaScript off. The two
 * exceptions are the image uploader, because a file input has no
 * server-rendered equivalent, and the delete confirmation, which degrades to a
 * plain submit.
 *
 * Ordering is not here. It belongs to the list, where the client can see what
 * they are ordering against.
 */

export default async function AdminHeroStoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;

  const story = await getAdminHeroStory(id);
  if (!story) notFound();

  const hasImage = story.imageUrl !== "";
  // The schema permits a label without a link and components/HeroStory.tsx
  // degrades to a Story with no button, so this warns rather than refusing --
  // an editor that will not save cannot hold a half-drafted row.
  const halfCta = Boolean(story.ctaLabel) !== Boolean(story.ctaHref);

  return (
    <div>
      <Link
        href="/admin/hero"
        className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate hover:text-ssuni-brown transition-colors"
      >
        ← All hero stories
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-4 mt-4 mb-8">
        <h2 className="font-cinzel text-2xl">{story.title}</h2>
        <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
          {story.isHidden ? "Hidden" : "On the home page"}
        </span>
      </div>

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

      {/* ---- Picture ---- */}
      <section className="mb-12">
        <h3 className="font-cinzel text-xl mb-4">Picture</h3>

        <div className="flex flex-wrap items-start gap-6">
          <div className="relative w-64 aspect-[3/2] bg-ssuni-light2 overflow-hidden shrink-0">
            {hasImage ? (
              <Image src={story.imageUrl} alt="" fill sizes="256px" className="object-cover" />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
                No image yet
              </span>
            )}
          </div>

          <div className="grow min-w-[16rem]">
            <AdminImageUploader
              // Inside the Product images bucket under a hero/ folder. The
              // bucket's policies are scoped to the bucket and an admin check,
              // with no opinion about the path, so this needs no migration.
              pathPrefix={`hero/${story.id}`}
              hiddenFields={{ storyId: story.id }}
              action={setHeroImageAction}
              label={hasImage ? "Replace the picture" : "Add a picture"}
            />
            <p className="font-belleza text-xs text-ssuni-slate mt-3">
              This fills the whole screen, so use something wide and high-resolution. Replacing it
              takes effect on the home page immediately.
            </p>
          </div>
        </div>
      </section>

      {/* ---- Words ---- */}
      <section className="mb-12">
        <h3 className="font-cinzel text-xl mb-4">Words</h3>

        <form action={updateHeroStoryAction} className="flex flex-col gap-5 max-w-xl">
          <input type="hidden" name="storyId" value={story.id} />

          <Field
            label="Eyebrow"
            name="eyebrow"
            defaultValue={story.eyebrow ?? ""}
            placeholder="SSUNI Fall 2026 Collection"
            hint="The small line above the headline. Optional."
          />
          <Field
            label="Title"
            name="title"
            defaultValue={story.title}
            required
            hint="The headline. The first story on the page uses this as the page's main heading."
          />
          <Field
            label="Subtitle"
            name="subtitle"
            defaultValue={story.subtitle ?? ""}
            placeholder="Our humble beginnings"
            hint="One line under the headline. Optional."
          />

          <div className="flex flex-wrap gap-5">
            <div className="grow min-w-[12rem]">
              <Field
                label="Button label"
                name="ctaLabel"
                defaultValue={story.ctaLabel ?? ""}
                placeholder="Explore the Catalog"
              />
            </div>
            <div className="grow min-w-[12rem]">
              <Field
                label="Button link"
                name="ctaHref"
                defaultValue={story.ctaHref ?? ""}
                placeholder="/catalog"
              />
            </div>
            <p className="font-belleza text-xs text-ssuni-slate basis-full">
              {halfCta ? (
                <strong className="text-ssuni-brown">
                  No button will appear: a button needs both a label and a link. Your work is
                  saved either way — fill in the other half when you know it.
                </strong>
              ) : (
                "Both or neither. With only one filled in, the story shows no button."
              )}
            </p>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="isHidden"
              defaultChecked={story.isHidden}
              className="accent-ssuni-brown"
            />
            <span className="font-belleza text-sm">
              Hidden — not on the home page for anyone, including you
            </span>
          </label>
          {!hasImage && (
            <p className="font-belleza text-xs text-ssuni-slate -mt-3">
              This story has no picture yet, so it cannot be shown. Add one above first.
            </p>
          )}

          <button
            type="submit"
            className="self-start bg-ssuni-brown text-ssuni-light1 px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-slate transition-colors cursor-pointer"
          >
            Save
          </button>
        </form>
      </section>

      {/* ---- Danger ---- */}
      <section className="border-t border-ssuni-light2 pt-8">
        <h3 className="font-cinzel text-xl mb-2">Delete this story</h3>
        <p className="font-belleza text-sm text-ssuni-slate mb-4 max-w-xl">
          This throws away the words and the picture, and cannot be undone.{" "}
          <strong className="text-ssuni-brown">Hide it instead</strong> if you have simply stopped
          using it — a hidden story keeps everything and is one tick away from coming back.
        </p>
        <form action={deleteHeroStoryAction}>
          <input type="hidden" name="storyId" value={story.id} />
          <ConfirmSubmitButton
            message={`Delete "${story.title}"? The words and the picture go with it, and this cannot be undone.`}
            className="border border-ssuni-brown px-6 py-2.5 font-belleza uppercase tracking-widest text-xs hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors cursor-pointer"
          >
            Delete story
          </ConfirmSubmitButton>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  hint,
  ...input
}: { label: string; name: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-belleza text-xs uppercase tracking-widest text-ssuni-slate">
        {label}
      </span>
      <input
        name={name}
        {...input}
        className="font-belleza border border-ssuni-light2 bg-ssuni-light1 px-3 py-2 text-sm"
      />
      {hint && <span className="font-belleza text-xs text-ssuni-slate">{hint}</span>}
    </label>
  );
}
