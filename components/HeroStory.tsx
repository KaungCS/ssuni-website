import Image from "next/image";
import Link from "next/link";
import type { HeroStory as HeroStoryData } from "@/lib/hero";

/**
 * One Hero Story panel. Issue #22, per ADR 0003 (amended 2026-09-18).
 *
 * The landing page stacks as many of these as `hero_stories` holds, so this
 * component renders exactly one and knows nothing about how many there are --
 * except through `index`, which drives the two things that genuinely differ
 * between the first panel and the rest (see below).
 *
 * A server component, and it only takes data, so it stays one either way.
 */
export default function HeroStory({
  story,
  index,
}: {
  story: HeroStoryData;
  index: number;
}) {
  const isFirst = index === 0;

  return (
    <section className="relative w-full h-screen bg-ssuni-light2 flex items-center justify-center overflow-hidden">
      {/* Background Image / Storytelling Visual */}
      <div className="absolute inset-0 z-0">
        <Image
          src={story.imageUrl}
          alt={story.title}
          fill
          // Full-bleed at every breakpoint.
          sizes="100vw"
          className="object-cover opacity-90"
          // Every panel is a full-screen image, so a client with six Stories
          // ships six of them. Only the first is above the fold; the rest wait
          // until the shopper scrolls toward them. `priority` is next/image's
          // way of saying eager + high fetchpriority, and it must not be set on
          // more than one panel or it stops meaning anything.
          priority={isFirst}
          loading={isFirst ? undefined : "lazy"}
        />
        {/* Soft overlay matching brand mood */}
        <div className="absolute inset-0 bg-ssuni-light1/10" />
      </div>

      {/* Floating Story Content */}
      <div className="relative z-10 text-center max-w-2xl px-4 text-ssuni-brown flex flex-col items-center">

        {/* Text-shadow creates a subtle halo so the copy stays readable over an
            arbitrary photograph -- the client picks the image, so the contrast
            cannot be checked at build time. */}
        {story.eyebrow && (
          <p className="font-belleza uppercase tracking-[0.25em] text-sm mb-3 [text-shadow:_0_2px_10px_rgba(0,0,0,0.8)]">
            {story.eyebrow}
          </p>
        )}

        {/* The first Story carries the page's h1; the rest are h2. A page with
            six h1s is a page a screen reader cannot outline. */}
        {isFirst ? (
          <h1 className="font-cinzel text-5xl md:text-7xl font-normal text-ssuni-light2 mb-6 uppercase [text-shadow:_0_2px_15px_rgba(0,0,0,0.9)]">
            {story.title}
          </h1>
        ) : (
          <h2 className="font-cinzel text-4xl md:text-6xl font-normal text-ssuni-light2 mb-6 uppercase [text-shadow:_0_2px_15px_rgba(0,0,0,0.9)]">
            {story.title}
          </h2>
        )}

        {story.subtitle && (
          <p className="font-belleza text-lg mb-8 text-ssuni-light2 [text-shadow:_0_2px_10px_rgba(0,0,0,0.8)]">
            {story.subtitle}
          </p>
        )}

        {/* Backdrop blur and a semi-transparent fill keep the button readable
            over the same arbitrary photograph. */}
        {story.cta && (
          <Link
            href={story.cta.href}
            className="inline-block border border-ssuni-brown px-8 py-3 font-belleza tracking-widest text-sm uppercase hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors duration-300 bg-white/20 backdrop-blur-[2px] shadow-sm"
          >
            {story.cta.label}
          </Link>
        )}
      </div>
    </section>
  );
}
