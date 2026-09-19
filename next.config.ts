import type { NextConfig } from "next";

/**
 * Near-empty, and it still has to exist. Next itself is happy without this file,
 * so deleting it passes `npm run dev` and `npm run build` -- but
 * `opennextjs-cloudflare build` looks the file up directly and exits 1 with
 * "next.config.js not found. Please make sure you are running this command
 * inside a Next.js app", which takes the deploy with it. Verified 2026-09-18.
 */
const nextConfig: NextConfig = {
  images: {
    /**
     * Product and Hero Story images come from Supabase Storage (#11, ADR 0009),
     * which is a different origin from the app. Without an entry here every
     * `next/image` request for one is rejected -- and rejected by *our own
     * worker*, not by Next in the abstract: `@opennextjs/cloudflare`'s
     * `/_next/image` handler calls `hasRemoteMatch(__IMAGES_REMOTE_PATTERNS__,
     * url)` and answers 400 `"url" parameter is not allowed` when nothing
     * matches. See node_modules/@opennextjs/cloudflare/dist/cli/templates/images.js.
     *
     * Matched by wildcard host rather than by NEXT_PUBLIC_SUPABASE_URL on
     * purpose. That variable is a Cloudflare *build* variable (CLAUDE.md), so
     * deriving the pattern from it would mean a build with the variable unset
     * silently produces a site whose every product photo 400s -- on top of the
     * failure CLAUDE.md already documents. The pathname is pinned to the public
     * object route, so this grants the optimizer nothing beyond public Storage.
     */
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
