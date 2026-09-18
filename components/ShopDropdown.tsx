import React from "react";
import Link from "next/link";
import {
  COLLECTION_SLUGS,
  DEPARTMENT_SLUGS,
  categoryLabel,
  collectionLabel,
  departmentLabel,
} from "@/lib/taxonomy";

interface ShopDropdownProps {
  isOpen: boolean;
  onMouseEnter: () => void;
}

type MenuLink = { href: string; label: string };

/**
 * Labels come from lib/taxonomy.ts, never typed out here. This file was the
 * third copy of the vocabulary and the copies had already drifted -- the menu
 * said "The Rabbit Hole Drop" where the catalog heading said "The Rabbit Hole"
 * (#51). Departments and Collections map over the declared lists; Categories
 * are split across two columns by merchandising, so those name slugs only.
 */
const department = (slug: string): MenuLink => ({
  href: `/catalog?department=${slug}`,
  label: departmentLabel(slug),
});

const category = (slug: string): MenuLink => ({
  href: `/catalog?category=${slug}`,
  label: categoryLabel(slug),
});

const collection = (slug: string): MenuLink => ({
  href: `/catalog?collection=${slug}`,
  label: collectionLabel(slug),
});

const COLUMNS: { title: string; links: MenuLink[] }[] = [
  {
    title: "Featured",
    // New Arrivals is `?new=true`, its own dimension rather than a Collection.
    links: [
      { href: "/catalog?new=true", label: "New Arrivals" },
      ...COLLECTION_SLUGS.map(collection),
    ],
  },
  {
    title: "Department",
    links: [...DEPARTMENT_SLUGS.map(department), { href: "/catalog", label: "View All" }],
  },
  {
    title: "Clothing",
    links: ["tees", "knitwear", "hoodies", "bottoms"].map(category),
  },
  {
    title: "Accessories",
    links: ["totes", "headwear", "collectibles"].map(category),
  },
];

export default function ShopDropdown({ isOpen, onMouseEnter }: ShopDropdownProps) {
  if (!isOpen) return null;

  return (
    <div
      className="absolute top-24 left-0 w-full bg-ssuni-light1 border-b border-stone-300/80 shadow-md py-12 px-6 transition-all duration-300"
      onMouseEnter={onMouseEnter}
    >
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10 text-ssuni-brown">
        {COLUMNS.map((column) => (
          <div key={column.title} className="space-y-4">
            <h3 className="font-cinzel text-base tracking-wider font-semibold border-b border-ssuni-brown/20 pb-2">
              {column.title}
            </h3>
            <ul className="space-y-2.5 text-sm font-belleza text-stone-700">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="hover:text-ssuni-brown hover:underline block transition-all"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
