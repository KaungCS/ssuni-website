import HeroStory from "@/components/HeroStory";
import { getHeroStories } from "@/lib/hero";

/**
 * The landing page. Issue #22, per ADR 0003 (amended 2026-09-18).
 *
 * Hero Stories come from the database and stack vertically, in `sort_order`.
 * There is no fixed number of Slots: adding a row in Supabase Studio adds a
 * section to this page, and ticking `is_hidden` removes it. Neither needs a
 * deploy, which is the whole point of #22.
 *
 * Dynamic for the same reason the catalog is: the client edits Hero Stories in
 * Studio and expects to see the change on the next load, not on the next deploy
 * or whenever a cache lapses. This is one small query and the page is mostly
 * images; when #41 revisits caching, revalidate-on-a-timer is the upgrade path,
 * and the client's tolerance for a stale home page is the input to that.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const stories = await getHeroStories();

  return (
    <div>
      {/* Every visible Story Hidden at once is one click away in Supabase Studio,
          and #22 moved the guaranteed hero out of the code to get here. Without
          this branch that leaves the landing page as one stray paragraph -- and,
          because the first Story carries the page h1, with no h1 at all. */}
      {stories.length === 0 ? (
        <section className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
          <h1 className="font-cinzel text-5xl md:text-7xl uppercase tracking-wider text-ssuni-brown mb-6">
            SSUNI
          </h1>
          <p className="font-belleza text-lg text-ssuni-slate">
            Soft days and quiet elegance.
          </p>
        </section>
      ) : (
        stories.map((story, index) => (
          <HeroStory key={story.id} story={story} index={index} />
        ))
      )}

      {/* Quick intro section or secondary collection preview */}
      <section className="py-20 px-6 max-w-7xl mx-auto text-center">
        <h2 className="font-cinzel text-3xl mb-4 tracking-wider">The SSUNI Philosophy</h2>
        <p className="font-belleza text-lg text-stone-700 max-w-xl mx-auto">
          Thoughtfully designed apparel bringing quiet elegance and comfort to your everyday wardrobe.
        </p>
      </section>
    </div>
  );
}
