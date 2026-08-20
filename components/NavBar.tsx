"use client";

import React, { useState } from "react";
import Link from "next/link";
import ShopDropdown from "./ShopDropdown";

export default function NavBar() {
  const [isShopOpen, setIsShopOpen] = useState(false);

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
            <img 
              src="/images/ssuni-logo.png" 
              alt="SSUNI Bunny Logo" 
              className="h-12 w-auto object-contain"
            />
            <img 
              src="/images/ssuni-logo-text.png" 
              alt="SSUNI Script Logo" 
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
            Cart <span className="text-xs border border-ssuni-brown px-2 py-0.5 rounded-full">0</span>
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