import Link from "next/link";

export default function HeroStory() {
  return (
    <section className="relative w-full h-screen bg-ssuni-light2 flex items-center justify-center overflow-hidden">
      {/* Background Image / Storytelling Visual */}
      <div className="absolute inset-0 z-0">
        <img
          src="/images/download.jpeg" 
          alt="SSUNI Collection Story"
          className="w-full h-full object-cover opacity-90"
        />
        {/* Soft overlay matching brand mood */}
        <div className="absolute inset-0 bg-ssuni-light1/10" />
      </div>

      {/* Floating Story Content */}
      <div className="relative z-10 text-center max-w-2xl px-4 text-ssuni-brown flex flex-col items-center">
        
        {/* Added text-shadow to create a subtle light halo around the dark letters */}
        <p className="font-belleza uppercase tracking-[0.25em] text-sm mb-3 [text-shadow:_0_2px_10px_rgba(0,0,0,0.8)]">
          SSUNI Fall 2026 Collection
        </p>
        
        <h1 className="font-cinzel text-5xl md:text-7xl font-normal text-ssuni-light2 mb-6 uppercase [text-shadow:_0_2px_15px_rgba(0,0,0,0.9)]">
          Hi U District
        </h1>
        
        <p className="font-belleza text-lg mb-8 text-ssuni-light2 [text-shadow:_0_2px_10px_rgba(0,0,0,0.8)]">
          Our humble beginnings
        </p>
        
        {/* Added a subtle backdrop blur and semi-transparent background to keep the button readable */}
        <Link
          href="/catalog"
          className="inline-block border border-ssuni-brown px-8 py-3 font-belleza tracking-widest text-sm hover:bg-ssuni-brown hover:text-ssuni-light1 transition-colors duration-300 bg-white/20 backdrop-blur-[2px] shadow-sm"
        >
          EXPLORE THE CATALOG
        </Link>
      </div>
    </section>
  );
}