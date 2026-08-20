import HeroStory from "@/components/HeroStory";

export default function Home() {
  return (
    <div>
      {/* Cinematic Uniqlo-style storytelling section */}
      <HeroStory />

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