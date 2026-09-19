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
      {stories.map((story, index) => (
        <HeroStory key={story.id} story={story} index={index} />
      ))}

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
