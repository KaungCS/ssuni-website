import React from "react";
import Link from "next/link";

interface ShopDropdownProps {
  isOpen: boolean;
  onMouseEnter: () => void;
}

export default function ShopDropdown({ isOpen, onMouseEnter }: ShopDropdownProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="absolute top-24 left-0 w-full bg-ssuni-light1 border-b border-stone-300/80 shadow-md py-12 px-6 transition-all duration-300"
      onMouseEnter={onMouseEnter}
    >
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10 text-ssuni-brown">
        
        {/* Column 1: Featured & Drops */}
        <div className="space-y-4">
          <h3 className="font-cinzel text-base tracking-wider font-semibold border-b border-ssuni-brown/20 pb-2">
            Featured
          </h3>
          <ul className="space-y-2.5 text-sm font-belleza text-stone-700">
            <li><Link href="/catalog?filter=new" className="hover:text-ssuni-brown hover:underline block transition-all">New Arrivals</Link></li>
            <li><Link href="/catalog?filter=best-sellers" className="hover:text-ssuni-brown hover:underline block transition-all">Best Sellers</Link></li>
            <li><Link href="/catalog?collection=the-rabbit-hole" className="hover:text-ssuni-brown hover:underline block transition-all">The Rabbit Hole Drop</Link></li>
            <li><Link href="/catalog?filter=lookbook" className="hover:text-ssuni-brown hover:underline block transition-all">Fall Lookbook</Link></li>
          </ul>
        </div>

        {/* Column 2: Shop by Department */}
        <div className="space-y-4">
          <h3 className="font-cinzel text-base tracking-wider font-semibold border-b border-ssuni-brown/20 pb-2">
            Department
          </h3>
          <ul className="space-y-2.5 text-sm font-belleza text-stone-700">
            <li><Link href="/catalog?department=women" className="hover:text-ssuni-brown hover:underline block transition-all">Women</Link></li>
            <li><Link href="/catalog?department=men" className="hover:text-ssuni-brown hover:underline block transition-all">Men</Link></li>
            <li><Link href="/catalog?department=unisex" className="hover:text-ssuni-brown hover:underline block transition-all">Unisex Essentials</Link></li>
            <li><Link href="/catalog" className="hover:text-ssuni-brown hover:underline block transition-all">View All</Link></li>
          </ul>
        </div>

        {/* Column 3: Shop by Category */}
        <div className="space-y-4">
          <h3 className="font-cinzel text-base tracking-wider font-semibold border-b border-ssuni-brown/20 pb-2">
            Clothing
          </h3>
          <ul className="space-y-2.5 text-sm font-belleza text-stone-700">
            <li><Link href="/catalog?category=tees" className="hover:text-ssuni-brown hover:underline block transition-all">Tops & Baby Tees</Link></li>
            <li><Link href="/catalog?category=knitwear" className="hover:text-ssuni-brown hover:underline block transition-all">Knitwear & Sweaters</Link></li>
            <li><Link href="/catalog?category=hoodies" className="hover:text-ssuni-brown hover:underline block transition-all">Hoodies & Sweats</Link></li>
            <li><Link href="/catalog?category=bottoms" className="hover:text-ssuni-brown hover:underline block transition-all">Pants & Loungewear</Link></li>
          </ul>
        </div>

        {/* Column 4: Accessories & Extras */}
        <div className="space-y-4">
          <h3 className="font-cinzel text-base tracking-wider font-semibold border-b border-ssuni-brown/20 pb-2">
            Accessories
          </h3>
          <ul className="space-y-2.5 text-sm font-belleza text-stone-700">
            <li><Link href="/catalog?category=totes" className="hover:text-ssuni-brown hover:underline block transition-all">Canvas Tote Bags</Link></li>
            <li><Link href="/catalog?category=headwear" className="hover:text-ssuni-brown hover:underline block transition-all">Caps & Beanies</Link></li>
            <li><Link href="/catalog?category=collectibles" className="hover:text-ssuni-brown hover:underline block transition-all">Mascot Stickers & Keychains</Link></li>
          </ul>
        </div>

      </div>
    </div>
  );
}