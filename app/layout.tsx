import type { Metadata } from "next";
import { Cinzel, Belleza } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar"; // Import the new NavBar component

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
  weight: ["400", "600", "700"],
});

const belleza = Belleza({
  subsets: ["latin"],
  variable: "--font-belleza",
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "SSUNI | Official Store",
  description: "Soft days and quiet elegance.",
  icons: {
    icon: "/images/ssuni-logo-white-bg.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cinzel.variable} ${belleza.variable}`}>
      <body className="font-belleza antialiased selection:bg-ssuni-brown selection:text-ssuni-light1 flex flex-col min-h-screen">
        
        {/* Insert the decoupled NavBar component */}
        <NavBar />

        {/* Main Page Content */}
        <main className="flex-grow">{children}</main>

        {/* The Restored Footer */}
        <footer className="bg-ssuni-light2 py-12 border-t border-ssuni-light1">
          <div className="max-w-7xl mx-auto px-6 text-center text-ssuni-brown">
            <p className="font-cinzel tracking-widest text-lg mb-2">SSUNI</p>
            <p className="text-xs tracking-wider opacity-70 font-belleza">
              © {new Date().getFullYear()} SSUNI. All rights reserved.
            </p>
          </div>
        </footer>

      </body>
    </html>
  );
}