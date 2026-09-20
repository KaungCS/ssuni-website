"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ShopDropdown from "./ShopDropdown";
import { useCart } from "./CartProvider";

export default function NavBar() {
  const [isShopOpen, setIsShopOpen] = useState(false);
  const { count, hydrated } = useCart();

  return (
    <header 
      className="sticky top-0 z-50 w-full bg-ssuni-light1/95 backdrop-blur-md border-b border-ssuni-light2 transition-all duration-300"
      onMouseLeave={() => setIsShopOpen(false)}
    >
      {/* Main Bar */}
      <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between text-ssuni-brown relative">
        
        {/* Left: Shop Trigger Button */}
        <nav className="flex items-center">
          <button 
            onClick={() => setIsShopOpen(!isShopOpen)}
            onMouseEnter={() => setIsShopOpen(true)}
            className="text-sm uppercase tracking-widest font-belleza hover:opacity-70 transition-opacity flex items-center gap-2 cursor-pointer py-4"
          >
            Shop
            <span className={`text-xs transition-transform duration-200 ${isShopOpen ? "rotate-180" : ""}`}>
              ▼
            </span>
          </button>
        </nav>

        {/* Center: Brand Logos */}
        <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            {/* Both source files are 165x165. width/height give next/image the
                intrinsic ratio so it reserves the right box; the height and
                w-auto classes still decide the rendered size. */}
            <Image
              src="/images/ssuni-logo.png"
              alt="SSUNI Bunny Logo"
              width={165}
              height={165}
              priority
              className="h-12 w-auto object-contain"
            />
            <Image
              src="/images/ssuni-logo-text.png"
              alt="SSUNI Script Logo"
              width={165}
              height={165}
              priority
              className="h-10 w-auto object-contain hidden sm:block"
            />
          </Link>
        </div>

        {/* Right: Profile & Cart */}
        <div className="flex items-center space-x-6 text-sm uppercase tracking-widest font-belleza">
          <Link href="/profile" className="hidden sm:inline hover:opacity-70 transition-opacity">
            Profile
          </Link>
          <Link href="/cart" className="hover:opacity-70 transition-opacity flex items-center gap-2">
            Cart{" "}
            {/* Blank until the Cart has been read from localStorage. The server
                cannot know the count, so rendering one before hydration is a
                mismatch; a cookie mirror would fix the flash by putting the same
                truth in two stores, which drift (Q12, 2026-09-08). */}
            <span className="text-xs border border-ssuni-brown px-2 py-0.5 rounded-full min-w-[1.75rem] inline-block text-center">
              {hydrated ? count : " "}
            </span>
          </Link>
        </div>
      </div>

      {/* Extracted Mega Menu Component */}
      <ShopDropdown 
        isOpen={isShopOpen} 
        onMouseEnter={() => setIsShopOpen(true)} 
      />
      
    </header>
  );
}